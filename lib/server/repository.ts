import "server-only";
import { createHash } from "node:crypto";
import type { EventContentPart, EventKind, EventSummary, JobRecord, NormalizedEvent, NormalizedSession, ParsedSession, ProviderId } from "@/lib/types";
import { decodeRaw, encodeRawAsync } from "./compression";
import { getDb } from "./db";

async function encodedJson(value: unknown) {
  if (value === undefined || value === null) return null;
  const encoded = await encodeRawAsync(value);
  return encoded.encoding === "br" ? encoded.data : encoded.data.toString("utf8");
}

function json(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function stableId(...parts: Array<string | number | null | undefined>) {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex").slice(0, 32);
}

export async function saveParsedSession(session: ParsedSession) {
  const db = getDb();
  const insertSession = db.prepare(`
    INSERT INTO sessions (id, provider, external_id, title, project_path, source_path, started_at, updated_at, model, available, metadata_json, event_count)
    VALUES (@id, @provider, @externalId, @title, @projectPath, @sourcePath, @startedAt, @updatedAt, @model, @available, @metadata, @eventCount)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      id=excluded.id, title=excluded.title, project_path=excluded.project_path,
      source_path=excluded.source_path, started_at=excluded.started_at, updated_at=excluded.updated_at,
      model=excluded.model, available=excluded.available, metadata_json=excluded.metadata_json,
      event_count=excluded.event_count
  `);
  const deleteEvents = db.prepare("DELETE FROM events WHERE session_id = ?");
  const deleteFts = db.prepare("DELETE FROM event_fts WHERE session_id = ?");
  const deleteStats = db.prepare("DELETE FROM session_event_stats WHERE session_id = ?");
  const insertEvent = db.prepare(`
    INSERT INTO events (
      id, session_id, sequence, timestamp, kind, role, turn_id, call_id, parent_id,
      tool_name, text, input_json, output_json, status, duration_ms, input_tokens,
      output_tokens, total_tokens, canonical_key, raw_payload, raw_encoding, raw_bytes, raw_record_count
    ) VALUES (
      @id, @sessionId, @sequence, @timestamp, @kind, @role, @turnId, @callId, @parentId,
      @toolName, @text, @inputJson, @outputJson, @status, @durationMs, @inputTokens,
      @outputTokens, @totalTokens, @canonicalKey, @rawPayload, @rawEncoding, @rawBytes, @rawRecordCount
    )
  `);
  const insertFts = db.prepare("INSERT INTO event_fts (event_id, session_id, provider, content) VALUES (?, ?, ?, ?)");
  const insertStats = db.prepare(`
    INSERT INTO session_event_stats (
      session_id, kind, event_count, timestamp_count, role_count, turn_id_count, call_id_count,
      parent_id_count, tool_name_count, text_count, input_count, output_count, status_count,
      duration_ms_count, input_tokens_count, output_tokens_count, total_tokens_count, sample_event_id
    ) VALUES (
      @sessionId, @kind, @eventCount, @timestampCount, @roleCount, @turnIdCount, @callIdCount,
      @parentIdCount, @toolNameCount, @textCount, @inputCount, @outputCount, @statusCount,
      @durationMsCount, @inputTokensCount, @outputTokensCount, @totalTokensCount, @sampleEventId
    )
  `);
  const collapsed: Array<{ event: ParsedSession["events"][number]; rawRecords: unknown[] }> = [];
  const canonical = new Map<string, number>();

  for (const sourceEvent of session.events) {
    const canonicalKey = sourceEvent.canonicalKey || null;
    const existingIndex = canonicalKey ? canonical.get(canonicalKey) : undefined;
    if (existingIndex !== undefined) {
      collapsed[existingIndex].rawRecords.push(sourceEvent.raw);
    } else {
      const nextIndex = collapsed.length;
      collapsed.push({ event: sourceEvent, rawRecords: [sourceEvent.raw] });
      if (canonicalKey) canonical.set(canonicalKey, nextIndex);
    }
    if (collapsed.length % 500 === 0) await new Promise((resolve) => setImmediate(resolve));
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    deleteFts.run(session.id);
    deleteStats.run(session.id);
    deleteEvents.run(session.id);
    insertSession.run({
      ...session,
      available: session.available ? 1 : 0,
      metadata: json(session.metadata),
      eventCount: collapsed.length,
    });

    const indexedPayloads = new Set<string>();
    const stats = new Map<EventKind, {
      sessionId: string; kind: EventKind; eventCount: number; timestampCount: number; roleCount: number;
      turnIdCount: number; callIdCount: number; parentIdCount: number; toolNameCount: number;
      textCount: number; inputCount: number; outputCount: number; statusCount: number;
      durationMsCount: number; inputTokensCount: number; outputTokensCount: number;
      totalTokensCount: number; sampleEventId: string;
    }>();
    const compressionBatchSize = 32;
    for (let batchStart = 0; batchStart < collapsed.length; batchStart += compressionBatchSize) {
      const batch = collapsed.slice(batchStart, batchStart + compressionBatchSize);
      const encoded = await Promise.all(batch.map(async ({ event, rawRecords }) => {
        const rawValue = rawRecords.length === 1 ? rawRecords[0] : { canonical: rawRecords[0], duplicateRecords: rawRecords.slice(1) };
        const [raw, inputJson, outputJson] = await Promise.all([
          encodeRawAsync(rawValue),
          encodedJson(event.input),
          encodedJson(event.output),
        ]);
        return { raw, inputJson, outputJson };
      }));
      for (let offset = 0; offset < batch.length; offset += 1) {
        const index = batchStart + offset;
        const { event, rawRecords } = batch[offset];
        const sequence = index;
        const canonicalKey = event.canonicalKey || null;
        const id = stableId(session.id, event.externalId || "", event.kind, sequence);
        const { raw, inputJson, outputJson } = encoded[offset];
        insertEvent.run({
          id,
          sessionId: session.id,
          sequence,
          timestamp: event.timestamp,
          kind: event.kind,
          role: event.role,
          turnId: event.turnId,
          callId: event.callId,
          parentId: event.parentId,
          toolName: event.toolName,
          text: event.text,
          inputJson,
          outputJson,
          status: event.status,
          durationMs: event.durationMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
          canonicalKey,
          rawPayload: raw.data,
          rawEncoding: raw.encoding,
          rawBytes: raw.bytes,
          rawRecordCount: rawRecords.length,
        });
        const stat = stats.get(event.kind) || {
          sessionId: session.id, kind: event.kind, eventCount: 0, timestampCount: 0, roleCount: 0,
          turnIdCount: 0, callIdCount: 0, parentIdCount: 0, toolNameCount: 0, textCount: 0,
          inputCount: 0, outputCount: 0, statusCount: 0, durationMsCount: 0, inputTokensCount: 0,
          outputTokensCount: 0, totalTokensCount: 0, sampleEventId: id,
        };
        stat.eventCount += 1;
        stat.timestampCount += event.timestamp == null ? 0 : 1;
        stat.roleCount += event.role == null ? 0 : 1;
        stat.turnIdCount += event.turnId == null ? 0 : 1;
        stat.callIdCount += event.callId == null ? 0 : 1;
        stat.parentIdCount += event.parentId == null ? 0 : 1;
        stat.toolNameCount += event.toolName == null ? 0 : 1;
        stat.textCount += event.text == null ? 0 : 1;
        stat.inputCount += event.input == null ? 0 : 1;
        stat.outputCount += event.output == null ? 0 : 1;
        stat.statusCount += event.status == null ? 0 : 1;
        stat.durationMsCount += event.durationMs == null ? 0 : 1;
        stat.inputTokensCount += event.inputTokens == null ? 0 : 1;
        stat.outputTokensCount += event.outputTokens == null ? 0 : 1;
        stat.totalTokensCount += event.totalTokens == null ? 0 : 1;
        stats.set(event.kind, stat);
        const searchParts = [...new Set([session.title, session.projectPath, event.text, event.toolName, json(event.input), json(event.output), event.searchableText]
          .filter((value): value is string => Boolean(value)))]
          .join("\n")
          .slice(0, 16 * 1024);
        const searchKey = createHash("sha1").update(searchParts).digest("hex");
        if (searchParts && !indexedPayloads.has(searchKey)) {
          insertFts.run(id, session.id, session.provider, searchParts);
          indexedPayloads.add(searchKey);
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const stat of stats.values()) insertStats.run(stat);
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

type SessionRow = {
  id: string; provider: ProviderId; external_id: string; title: string; project_path: string | null;
  source_path: string; started_at: string | null; updated_at: string | null; model: string | null;
  available: number; event_count: number; diagnostics_count?: number;
};

function mapSession(row: SessionRow): NormalizedSession {
  return {
    id: row.id, provider: row.provider, externalId: row.external_id, title: row.title,
    projectPath: row.project_path, sourcePath: row.source_path, startedAt: row.started_at,
    updatedAt: row.updated_at, model: row.model, available: Boolean(row.available),
    eventCount: row.event_count, diagnosticsCount: row.diagnostics_count || 0,
  };
}

export function listSessions(options: { provider?: ProviderId; query?: string; limit?: number; offset?: number }) {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.provider) { where.push("provider = ?"); params.push(options.provider); }
  if (options.query) { where.push("(title LIKE ? OR project_path LIKE ?)"); params.push(`%${options.query}%`, `%${options.query}%`); }
  params.push(Math.min(options.limit || 100, 250), options.offset || 0);
  const rows = db.prepare(`SELECT sessions.*, (SELECT COUNT(*) FROM diagnostics d WHERE d.source_path=sessions.source_path) diagnostics_count FROM sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(updated_at, started_at) DESC, title LIMIT ? OFFSET ?`).all(...params) as SessionRow[];
  return rows.map(mapSession);
}

type EventRow = {
  id: string; session_id: string; sequence: number; timestamp: string | null; kind: EventKind;
  role: string | null; turn_id: string | null; call_id: string | null; parent_id: string | null;
  tool_name: string | null; text: string | null; input_json: string | Buffer | null; output_json: string | Buffer | null;
  status: string | null; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null;
  total_tokens: number | null; raw_payload: Buffer; raw_encoding: string; raw_bytes: number; raw_record_count: number;
};

type EventSummaryRow = Omit<EventRow, "input_json" | "output_json" | "raw_payload" | "raw_encoding"> & {
  has_input: number;
  has_output: number;
};

const EVENT_SUMMARY_COLUMNS = `
  e.id, e.session_id, e.sequence, e.timestamp, e.kind, e.role, e.turn_id, e.call_id,
  e.parent_id, e.tool_name, e.text, e.status, e.duration_ms, e.input_tokens,
  e.output_tokens, e.total_tokens, e.raw_bytes, e.raw_record_count,
  e.input_json IS NOT NULL AS has_input,
  e.output_json IS NOT NULL AS has_output
`;

function parseJson(value: string | Buffer | null) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return decodeRaw(value, "br");
  try { return JSON.parse(value); } catch { return value; }
}

function mapEvent(row: EventRow, includeRaw = false): NormalizedEvent {
  return {
    id: row.id, sessionId: row.session_id, sequence: row.sequence, timestamp: row.timestamp,
    kind: row.kind, role: row.role, turnId: row.turn_id, callId: row.call_id, parentId: row.parent_id,
    toolName: row.tool_name, text: row.text, input: parseJson(row.input_json), output: parseJson(row.output_json),
    status: row.status, durationMs: row.duration_ms, inputTokens: row.input_tokens,
    outputTokens: row.output_tokens, totalTokens: row.total_tokens, rawRecordCount: row.raw_record_count,
    ...(includeRaw ? { raw: decodeRaw(row.raw_payload, row.raw_encoding) } : {}),
  };
}

function mapEventSummary(row: EventSummaryRow): EventSummary {
  return {
    id: row.id, sessionId: row.session_id, sequence: row.sequence, timestamp: row.timestamp,
    kind: row.kind, role: row.role, turnId: row.turn_id, callId: row.call_id, parentId: row.parent_id,
    toolName: row.tool_name, text: row.text, status: row.status, durationMs: row.duration_ms,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens, totalTokens: row.total_tokens,
    hasInput: Boolean(row.has_input), hasOutput: Boolean(row.has_output),
    rawBytes: row.raw_bytes, rawRecordCount: row.raw_record_count,
  };
}

export function getSession(id: string) {
  const row = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function listEvents(sessionId: string, kinds: EventKind[] = [], limit = 500, offset = 0) {
  const params: unknown[] = [sessionId];
  let filter = "";
  if (kinds.length) {
    filter = ` AND kind IN (${kinds.map(() => "?").join(",")})`;
    params.push(...kinds);
  }
  params.push(Math.min(limit, 1000), offset);
  const rows = getDb().prepare(`SELECT * FROM events WHERE session_id = ?${filter} ORDER BY sequence LIMIT ? OFFSET ?`).all(...params) as EventRow[];
  return rows.map((row) => mapEvent(row));
}

export function listEventPage(options: { sessionId: string; kinds?: EventKind[]; limit?: number; offset?: number; anchorEventId?: string }) {
  const db = getDb();
  const kinds = options.kinds || [];
  const limit = Math.min(Math.max(options.limit || 200, 1), 200);
  let offset = Math.max(options.offset || 0, 0);
  const kindFilter = kinds.length ? ` AND e.kind IN (${kinds.map(() => "?").join(",")})` : "";
  const baseParams: unknown[] = [options.sessionId, ...kinds];
  let anchorFound = !options.anchorEventId;

  if (options.anchorEventId) {
    const anchor = db.prepare("SELECT sequence, kind FROM events WHERE id = ? AND session_id = ?")
      .get(options.anchorEventId, options.sessionId) as { sequence: number; kind: EventKind } | undefined;
    anchorFound = Boolean(anchor && (!kinds.length || kinds.includes(anchor.kind)));
    if (anchorFound && anchor) {
      const before = db.prepare(`SELECT COUNT(*) count FROM events e WHERE e.session_id = ?${kindFilter} AND e.sequence < ?`)
        .get(...baseParams, anchor.sequence) as { count: number };
      offset = Math.floor(before.count / limit) * limit;
    } else {
      offset = 0;
    }
  }

  const total = (db.prepare(`SELECT COUNT(*) count FROM events e WHERE e.session_id = ?${kindFilter}`)
    .get(...baseParams) as { count: number }).count;
  const rows = db.prepare(`
    SELECT ${EVENT_SUMMARY_COLUMNS}
    FROM events e
    WHERE e.session_id = ?${kindFilter}
    ORDER BY e.sequence
    LIMIT ? OFFSET ?
  `).all(...baseParams, limit + 1, offset) as EventSummaryRow[];
  const hasNext = rows.length > limit;

  return {
    data: rows.slice(0, limit).map(mapEventSummary),
    total,
    offset,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    nextOffset: hasNext ? offset + limit : null,
    anchorFound,
  };
}

export function getEvent(id: string) {
  const row = getDb().prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
  return row ? mapEvent(row, true) : null;
}

export type StoredEventContent = {
  data: Buffer;
  encoding: "identity" | "br";
  bytes: number | null;
};

export function getEventContent(id: string, part: EventContentPart): StoredEventContent | null {
  const db = getDb();
  if (part === "raw") {
    const row = db.prepare("SELECT raw_payload value, raw_encoding encoding, raw_bytes bytes FROM events WHERE id = ?")
      .get(id) as { value: Buffer; encoding: "identity" | "br"; bytes: number } | undefined;
    return row ? { data: row.value, encoding: row.encoding, bytes: row.bytes } : null;
  }

  const column = part === "input" ? "input_json" : "output_json";
  const row = db.prepare(`SELECT ${column} value FROM events WHERE id = ?`).get(id) as { value: string | Buffer | null } | undefined;
  if (!row?.value) return null;
  if (Buffer.isBuffer(row.value)) return { data: row.value, encoding: "br", bytes: null };
  return { data: Buffer.from(row.value, "utf8"), encoding: "identity", bytes: Buffer.byteLength(row.value) };
}

export function searchEvents(query: string, provider?: ProviderId, limit = 80, offset = 0) {
  const providerFilter = provider ? "AND f.provider = ?" : "";
  const params = provider ? [query, provider, limit, offset] : [query, limit, offset];
  const rows = getDb().prepare(`
    SELECT ${EVENT_SUMMARY_COLUMNS}, f.provider AS search_provider,
      snippet(event_fts, 3, '<mark>', '</mark>', '…', 18) AS snippet
    FROM event_fts f JOIN events e ON e.id = f.event_id
    WHERE event_fts MATCH ? ${providerFilter}
    ORDER BY bm25(event_fts) LIMIT ? OFFSET ?
  `).all(...params) as Array<EventSummaryRow & { snippet: string; search_provider: ProviderId }>;
  return rows.map((row) => ({ ...mapEventSummary(row), snippet: row.snippet, provider: row.search_provider }));
}

export function overview() {
  const db = getDb();
  const providers = db.prepare(`
    SELECT s.id, s.label, s.status, s.note, COUNT(DISTINCT se.id) session_count, COUNT(e.id) event_count,
      (SELECT COUNT(*) FROM diagnostics d WHERE d.provider=s.id) diagnostic_count
    FROM sources s LEFT JOIN sessions se ON se.provider=s.id LEFT JOIN events e ON e.session_id=se.id
    GROUP BY s.id ORDER BY CASE s.id WHEN 'claude-code' THEN 1 WHEN 'claude-desktop' THEN 2 WHEN 'codex' THEN 3 WHEN 'cursor' THEN 4 WHEN 'chatgpt' THEN 5 ELSE 6 END
  `).all() as Array<{ id: ProviderId; label: string; status: "ready" | "empty" | "warning"; note: string | null; session_count: number; event_count: number; diagnostic_count: number }>;
  const totals = db.prepare("SELECT COUNT(*) sessions, COALESCE(SUM(event_count),0) events FROM sessions").get() as { sessions: number; events: number };
  const lastScan = db.prepare("SELECT updated_at FROM jobs WHERE kind='scan' AND status='completed' ORDER BY updated_at DESC LIMIT 1").get() as { updated_at: string } | undefined;
  const activeJob = db.prepare("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  return {
    providers: providers.map((p) => ({ id: p.id, label: p.label, status: p.status, note: p.note || undefined, sessionCount: p.session_count, eventCount: p.event_count, diagnosticCount: p.diagnostic_count })),
    totalSessions: totals.sessions,
    totalEvents: totals.events,
    lastScanAt: lastScan?.updated_at || null,
    activeJob: activeJob ? mapJob(activeJob) : null,
  };
}

export function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id), kind: row.kind as JobRecord["kind"], status: row.status as JobRecord["status"],
    progress: Number(row.progress), processedFiles: Number(row.processed_files), totalFiles: Number(row.total_files),
    processedEvents: Number(row.processed_events), message: row.message ? String(row.message) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
