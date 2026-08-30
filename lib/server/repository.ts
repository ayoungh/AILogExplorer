import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AnalyticsBreakdown,
  AnalyticsResponse,
  EventContentPart,
  EventKind,
  EventSummary,
  FileReferenceAction,
  JobRecord,
  NormalizedEvent,
  NormalizedSession,
  ParsedSession,
  ProviderId,
  RecentFilesResponse,
  SearchFacets,
  SearchResponse,
  SearchSort,
  SessionMetrics,
} from "@/lib/types";
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

const DERIVED_SCHEMA_VERSION = "1";
const PATH_KEYS = new Set(["path", "filepath", "file_path", "filename", "file", "paths", "files"]);
const SEARCH_CACHE_LIMIT = 40;
const searchResponseCache = new Map<string, SearchResponse>();

function clearRepositoryCaches() {
  searchResponseCache.clear();
}

type DerivedEvent = {
  id: string;
  sequence: number;
  timestamp: string | null;
  kind: EventKind;
  status: string | null;
  callId: string | null;
  toolName: string | null;
  text: string | null;
  input: unknown;
  output: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  searchableText?: string;
};

function validIso(value: string | null | undefined) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function utcHour(value: string) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function normalizeObservedPath(value: unknown, projectPath: string | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4_096 || /[\r\n\0]/.test(trimmed) || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("-") || trimmed === "." || trimmed === "..") return null;
  const normalized = projectPath && !path.isAbsolute(trimmed) && !trimmed.startsWith("~")
    ? path.resolve(projectPath, trimmed)
    : path.normalize(trimmed);
  return normalized === "." || normalized === path.sep ? null : normalized;
}

function structuredPaths(value: unknown, projectPath: string | null) {
  const found = new Set<string>();
  const visit = (current: unknown, key = "", depth = 0) => {
    if (depth > 6 || current == null) return;
    if (typeof current === "string" && PATH_KEYS.has(key.toLowerCase())) {
      const candidate = normalizeObservedPath(current, projectPath);
      if (candidate) found.add(candidate);
      return;
    }
    if (Array.isArray(current)) {
      if (PATH_KEYS.has(key.toLowerCase())) {
        for (const item of current) {
          const candidate = normalizeObservedPath(item, projectPath);
          if (candidate) found.add(candidate);
        }
      } else current.forEach((item) => visit(item, key, depth + 1));
      return;
    }
    if (typeof current === "object") {
      for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) visit(child, childKey, depth + 1);
    }
  };
  visit(value);
  return [...found];
}

function patchReferences(value: unknown, projectPath: string | null) {
  const texts: string[] = [];
  const visit = (current: unknown, depth = 0) => {
    if (depth > 4 || current == null) return;
    if (typeof current === "string") texts.push(current);
    else if (Array.isArray(current)) current.forEach((item) => visit(item, depth + 1));
    else if (typeof current === "object") Object.values(current as Record<string, unknown>).forEach((item) => visit(item, depth + 1));
  };
  visit(value);
  const references: Array<{ path: string; action: FileReferenceAction }> = [];
  for (const text of texts) {
    for (const match of text.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
      const candidate = normalizeObservedPath(match[2], projectPath);
      if (candidate) references.push({ path: candidate, action: match[1] === "Add" ? "create" : match[1] === "Delete" ? "delete" : "write" });
    }
  }
  return references;
}

function toolAction(toolName: string | null): FileReferenceAction {
  const name = (toolName || "").toLowerCase();
  if (/(delete|remove|unlink)/.test(name)) return "delete";
  if (/(write|edit|patch|replace|create)/.test(name)) return "write";
  if (/(read|view|open|load)/.test(name)) return "read";
  return "unknown";
}

function buildDerived(session: Pick<ParsedSession, "id" | "provider" | "projectPath" | "startedAt" | "updatedAt">, events: DerivedEvent[]) {
  const validTimestamps = events.map((event) => validIso(event.timestamp)).filter((value): value is string => Boolean(value)).sort();
  const fallbackStart = validIso(session.startedAt);
  const fallbackEnd = validIso(session.updatedAt);
  const observedStartedAt = validTimestamps[0] || fallbackStart || fallbackEnd || null;
  const observedEndedAt = validTimestamps.at(-1) || fallbackEnd || fallbackStart || null;
  const durationMs = observedStartedAt && observedEndedAt ? Math.max(0, Date.parse(observedEndedAt) - Date.parse(observedStartedAt)) : null;
  const userMessageCount = events.filter((event) => event.kind === "user_message").length;
  const assistantMessageCount = events.filter((event) => event.kind === "assistant_message").length;
  const errors = events.filter((event) => event.kind === "error" || ["error", "failed"].includes((event.status || "").toLowerCase())).length;
  const latestUsage = session.provider === "codex"
    ? [...events].reverse().find((event) => event.kind === "usage" && [event.inputTokens, event.outputTokens, event.totalTokens].some((value) => value != null))
    : undefined;
  const metrics: SessionMetrics = {
    sessionId: session.id,
    observedStartedAt,
    observedEndedAt,
    durationMs,
    messageCount: userMessageCount + assistantMessageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount: events.filter((event) => event.kind === "tool_call").length,
    toolResultCount: events.filter((event) => event.kind === "tool_result").length,
    errorCount: errors,
    inputTokens: latestUsage?.inputTokens ?? null,
    outputTokens: latestUsage?.outputTokens ?? null,
    totalTokens: latestUsage?.totalTokens ?? null,
    tokenRecorded: Boolean(latestUsage),
    tokenTimestamp: validIso(latestUsage?.timestamp) || null,
    timestampedEventCount: validTimestamps.length,
    eventCount: events.length,
  };
  const activity = new Map<string, { eventCount: number; toolCallCount: number; errorCount: number }>();
  for (const event of events) {
    const timestamp = validIso(event.timestamp);
    if (!timestamp) continue;
    const bucket = utcHour(timestamp);
    const current = activity.get(bucket) || { eventCount: 0, toolCallCount: 0, errorCount: 0 };
    current.eventCount += 1;
    current.toolCallCount += event.kind === "tool_call" ? 1 : 0;
    current.errorCount += event.kind === "error" || ["error", "failed"].includes((event.status || "").toLowerCase()) ? 1 : 0;
    activity.set(bucket, current);
  }
  const references: Array<{ id: string; eventId: string; path: string; action: FileReferenceAction; source: "structured" | "patch"; timestamp: string | null }> = [];
  for (const event of events) {
    if (event.kind !== "tool_call") continue;
    const action = toolAction(event.toolName);
    for (const observedPath of structuredPaths(event.input, session.projectPath)) {
      references.push({ id: stableId(event.id, observedPath, action), eventId: event.id, path: observedPath, action, source: "structured", timestamp: validIso(event.timestamp) });
    }
    const patchValues = (event.toolName || "").toLowerCase().includes("patch") ? [event.input, event.text] : [];
    for (const patch of patchValues.flatMap((value) => patchReferences(value, session.projectPath))) {
      references.push({ id: stableId(event.id, patch.path, patch.action), eventId: event.id, path: patch.path, action: patch.action, source: "patch", timestamp: validIso(event.timestamp) });
    }
  }
  return { metrics, activity, references: [...new Map(references.map((reference) => [`${reference.eventId}:${reference.path}:${reference.action}`, reference])).values()] };
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
  const deleteMetrics = db.prepare("DELETE FROM session_metrics WHERE session_id = ?");
  const deleteActivity = db.prepare("DELETE FROM session_activity WHERE session_id = ?");
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
  const insertMetrics = db.prepare(`
    INSERT INTO session_metrics (
      session_id, observed_started_at, observed_ended_at, duration_ms, message_count,
      user_message_count, assistant_message_count, tool_call_count, tool_result_count,
      error_count, input_tokens, output_tokens, total_tokens, token_recorded, token_timestamp,
      timestamped_event_count, event_count
    ) VALUES (
      @sessionId, @observedStartedAt, @observedEndedAt, @durationMs, @messageCount,
      @userMessageCount, @assistantMessageCount, @toolCallCount, @toolResultCount,
      @errorCount, @inputTokens, @outputTokens, @totalTokens, @tokenRecorded, @tokenTimestamp,
      @timestampedEventCount, @eventCount
    )
  `);
  const insertActivity = db.prepare("INSERT INTO session_activity (session_id,bucket_start_utc,event_count,tool_call_count,error_count) VALUES (?,?,?,?,?)");
  const insertReference = db.prepare("INSERT OR REPLACE INTO file_references (id,event_id,session_id,path,action,source,timestamp) VALUES (?,?,?,?,?,?,?)");
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
    deleteMetrics.run(session.id);
    deleteActivity.run(session.id);
    deleteEvents.run(session.id);
    insertSession.run({
      ...session,
      available: session.available ? 1 : 0,
      metadata: json(session.metadata),
      eventCount: collapsed.length,
    });

    const storedEvents: DerivedEvent[] = [];
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
        storedEvents.push({ id, sequence, timestamp: event.timestamp, kind: event.kind, status: event.status,
          callId: event.callId, toolName: event.toolName, text: event.text, input: event.input, output: event.output,
          inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens,
          searchableText: event.searchableText });
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
        if (searchParts) insertFts.run(id, session.id, session.provider, searchParts);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const stat of stats.values()) insertStats.run(stat);
    const derived = buildDerived(session, storedEvents);
    insertMetrics.run({ ...derived.metrics, tokenRecorded: derived.metrics.tokenRecorded ? 1 : 0 });
    for (const [bucket, value] of derived.activity) insertActivity.run(session.id, bucket, value.eventCount, value.toolCallCount, value.errorCount);
    for (const reference of derived.references) insertReference.run(reference.id, reference.eventId, session.id, reference.path, reference.action, reference.source, reference.timestamp);
    const missingDerived = db.prepare("SELECT COUNT(*) count FROM sessions s LEFT JOIN session_metrics m ON m.session_id=s.id WHERE m.session_id IS NULL").get() as { count: number };
    if (!missingDerived.count) db.prepare("INSERT INTO schema_meta (key,value) VALUES ('derived_schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(DERIVED_SCHEMA_VERSION);
    db.exec("COMMIT");
    clearRepositoryCaches();
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

type SessionMetricsRow = {
  session_id: string; observed_started_at: string | null; observed_ended_at: string | null;
  duration_ms: number | null; message_count: number; user_message_count: number;
  assistant_message_count: number; tool_call_count: number; tool_result_count: number;
  error_count: number; input_tokens: number | null; output_tokens: number | null;
  total_tokens: number | null; token_recorded: number; token_timestamp: string | null;
  timestamped_event_count: number; event_count: number;
};

function mapMetrics(row: SessionMetricsRow): SessionMetrics {
  return {
    sessionId: row.session_id,
    observedStartedAt: row.observed_started_at,
    observedEndedAt: row.observed_ended_at,
    durationMs: row.duration_ms,
    messageCount: row.message_count,
    userMessageCount: row.user_message_count,
    assistantMessageCount: row.assistant_message_count,
    toolCallCount: row.tool_call_count,
    toolResultCount: row.tool_result_count,
    errorCount: row.error_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    tokenRecorded: Boolean(row.token_recorded),
    tokenTimestamp: row.token_timestamp,
    timestampedEventCount: row.timestamped_event_count,
    eventCount: row.event_count,
  };
}

export function ensureDerivedData() {
  const db = getDb();
  const marker = db.prepare("SELECT value FROM schema_meta WHERE key='derived_schema_version'").get() as { value: string } | undefined;
  if (marker?.value === DERIVED_SCHEMA_VERSION) return;
  clearRepositoryCaches();
  const sessions = db.prepare("SELECT * FROM sessions ORDER BY id").all() as SessionRow[];
  const insertFts = db.prepare("INSERT INTO event_fts (event_id,session_id,provider,content) VALUES (?,?,?,?)");
  const insertMetrics = db.prepare(`INSERT INTO session_metrics (
    session_id,observed_started_at,observed_ended_at,duration_ms,message_count,user_message_count,
    assistant_message_count,tool_call_count,tool_result_count,error_count,input_tokens,output_tokens,
    total_tokens,token_recorded,token_timestamp,timestamped_event_count,event_count
  ) VALUES (@sessionId,@observedStartedAt,@observedEndedAt,@durationMs,@messageCount,@userMessageCount,
    @assistantMessageCount,@toolCallCount,@toolResultCount,@errorCount,@inputTokens,@outputTokens,
    @totalTokens,@tokenRecorded,@tokenTimestamp,@timestampedEventCount,@eventCount)`);
  const insertActivity = db.prepare("INSERT INTO session_activity (session_id,bucket_start_utc,event_count,tool_call_count,error_count) VALUES (?,?,?,?,?)");
  const insertReference = db.prepare("INSERT OR REPLACE INTO file_references (id,event_id,session_id,path,action,source,timestamp) VALUES (?,?,?,?,?,?,?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM event_fts; DELETE FROM file_references; DELETE FROM session_activity; DELETE FROM session_metrics;");
    for (const sessionRow of sessions) {
      const rows = db.prepare("SELECT * FROM events WHERE session_id=? ORDER BY sequence").all(sessionRow.id) as EventRow[];
      const events: DerivedEvent[] = rows.map((row) => ({
        id: row.id, sequence: row.sequence, timestamp: row.timestamp, kind: row.kind, status: row.status,
        callId: row.call_id, toolName: row.tool_name, text: row.text, input: parseJson(row.input_json),
        output: parseJson(row.output_json), inputTokens: row.input_tokens, outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
      }));
      const session = mapSession(sessionRow);
      for (const event of events) {
        const searchParts = [...new Set([session.title, session.projectPath, event.text, event.toolName, json(event.input), json(event.output)]
          .filter((value): value is string => Boolean(value)))].join("\n").slice(0, 16 * 1024);
        if (searchParts) insertFts.run(event.id, session.id, session.provider, searchParts);
      }
      const derived = buildDerived(session, events);
      insertMetrics.run({ ...derived.metrics, tokenRecorded: derived.metrics.tokenRecorded ? 1 : 0 });
      for (const [bucket, value] of derived.activity) insertActivity.run(session.id, bucket, value.eventCount, value.toolCallCount, value.errorCount);
      for (const reference of derived.references) insertReference.run(reference.id, reference.eventId, session.id, reference.path, reference.action, reference.source, reference.timestamp);
    }
    db.prepare("INSERT INTO schema_meta (key,value) VALUES ('derived_schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(DERIVED_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
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

export type SearchOptions = {
  query: string;
  providers?: ProviderId[];
  projects?: string[];
  models?: string[];
  kinds?: EventKind[];
  sessionId?: string;
  from?: string;
  to?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
};

function ftsQuery(query: string) {
  const tokens = query.trim().split(/\s+/).slice(0, 16).map((token) => token.replaceAll('"', "")).filter(Boolean);
  return tokens.length ? tokens.map((token) => `"${token}"`).join(" ") : '"__ailog_no_match__"';
}

function searchResponse(options: SearchOptions): SearchResponse {
  ensureDerivedData();
  const cacheKey = JSON.stringify(options);
  const cached = searchResponseCache.get(cacheKey);
  if (cached) {
    searchResponseCache.delete(cacheKey);
    searchResponseCache.set(cacheKey, cached);
    return cached;
  }
  const db = getDb();
  const where = ["event_fts MATCH ?"];
  const params: unknown[] = [ftsQuery(options.query)];
  const addList = (column: string, values: readonly string[] | undefined) => {
    if (!values?.length) return;
    where.push(`${column} IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  };
  addList("s.provider", options.providers);
  addList("s.project_path", options.projects);
  addList("s.model", options.models);
  addList("e.kind", options.kinds);
  if (options.sessionId) { where.push("s.id = ?"); params.push(options.sessionId); }
  if (options.from) { where.push("COALESCE(e.timestamp,s.updated_at,s.started_at) >= ?"); params.push(options.from); }
  if (options.to) { where.push("COALESCE(e.timestamp,s.updated_at,s.started_at) < ?"); params.push(options.to); }
  const filter = where.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) count FROM event_fts f JOIN events e ON e.id=f.event_id JOIN sessions s ON s.id=e.session_id WHERE ${filter}`)
    .get(...params) as { count: number }).count;
  const limit = Math.min(Math.max(options.limit || 80, 1), 100);
  const offset = Math.max(options.offset || 0, 0);
  const order = options.sort === "recent"
    ? "COALESCE(e.timestamp,s.updated_at,s.started_at) DESC, e.sequence DESC"
    : options.sort === "sequence"
      ? "s.id, e.sequence"
      : "bm25(event_fts), COALESCE(e.timestamp,s.updated_at,s.started_at) DESC";
  type SearchRow = EventSummaryRow & {
    search_provider: ProviderId; session_title: string; project_path: string | null; model: string | null;
    session_started_at: string | null; session_updated_at: string | null; snippet: string;
  };
  const rows = db.prepare(`
    SELECT ${EVENT_SUMMARY_COLUMNS}, s.provider search_provider, s.title session_title,
      s.project_path, s.model, s.started_at session_started_at, s.updated_at session_updated_at,
      snippet(event_fts, 3, '<mark>', '</mark>', '…', 18) snippet
    FROM event_fts f JOIN events e ON e.id=f.event_id JOIN sessions s ON s.id=e.session_id
    WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as SearchRow[];
  const facetRows = <T extends { value: string; label: string; count: number }>(sql: string) => db.prepare(sql).all(...params) as T[];
  const facets: SearchFacets = {
    providers: facetRows(`SELECT s.provider value, so.label label, COUNT(*) count FROM event_fts f JOIN events e ON e.id=f.event_id JOIN sessions s ON s.id=e.session_id JOIN sources so ON so.id=s.provider WHERE ${filter} GROUP BY s.provider ORDER BY count DESC, label`),
    projects: facetRows(`SELECT s.project_path value, s.project_path label, COUNT(*) count FROM event_fts f JOIN events e ON e.id=f.event_id JOIN sessions s ON s.id=e.session_id WHERE ${filter} AND s.project_path IS NOT NULL GROUP BY s.project_path ORDER BY count DESC, label LIMIT 100`),
    models: facetRows(`SELECT s.model value, s.model label, COUNT(*) count FROM event_fts f JOIN events e ON e.id=f.event_id JOIN sessions s ON s.id=e.session_id WHERE ${filter} AND s.model IS NOT NULL GROUP BY s.model ORDER BY count DESC, label LIMIT 100`),
    kinds: facetRows(`SELECT e.kind value, REPLACE(e.kind,'_',' ') label, COUNT(*) count FROM event_fts f JOIN events e ON e.id=f.event_id JOIN sessions s ON s.id=e.session_id WHERE ${filter} GROUP BY e.kind ORDER BY count DESC, label`),
  };
  const response: SearchResponse = {
    data: rows.map((row) => ({ ...mapEventSummary(row), provider: row.search_provider, sessionTitle: row.session_title,
      projectPath: row.project_path, model: row.model, sessionStartedAt: row.session_started_at,
      sessionUpdatedAt: row.session_updated_at, snippet: row.snippet })),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
    facets,
  };
  searchResponseCache.set(cacheKey, response);
  if (searchResponseCache.size > SEARCH_CACHE_LIMIT) searchResponseCache.delete(searchResponseCache.keys().next().value!);
  return response;
}

export function searchEvents(query: string, provider?: ProviderId, limit?: number, offset?: number): SearchResponse["data"];
export function searchEvents(options: SearchOptions): SearchResponse;
export function searchEvents(queryOrOptions: string | SearchOptions, provider?: ProviderId, limit = 80, offset = 0) {
  const response = searchResponse(typeof queryOrOptions === "string"
    ? { query: queryOrOptions, providers: provider ? [provider] : undefined, limit, offset }
    : queryOrOptions);
  return typeof queryOrOptions === "string" ? response.data : response;
}

export function getSessionMetrics(sessionId: string) {
  ensureDerivedData();
  const row = getDb().prepare("SELECT * FROM session_metrics WHERE session_id=?").get(sessionId) as SessionMetricsRow | undefined;
  return row ? mapMetrics(row) : null;
}

export type AnalyticsOptions = {
  from: string;
  to: string;
  timezone?: string;
  providers?: ProviderId[];
  projects?: string[];
  models?: string[];
};

function localDay(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function analytics(options: AnalyticsOptions): AnalyticsResponse {
  ensureDerivedData();
  const db = getDb();
  const timezone = options.timezone || "UTC";
  const rangeFrom = validIso(options.from) || options.from;
  const rangeTo = validIso(options.to) || options.to;
  const dimensions: string[] = [];
  const dimensionParams: unknown[] = [];
  const addList = (column: string, values: readonly string[] | undefined) => {
    if (!values?.length) return;
    dimensions.push(`${column} IN (${values.map(() => "?").join(",")})`);
    dimensionParams.push(...values);
  };
  addList("s.provider", options.providers);
  addList("s.project_path", options.projects);
  addList("s.model", options.models);
  const sessionDate = "COALESCE(s.updated_at,s.started_at,m.observed_ended_at,m.observed_started_at)";
  const sessionWhere = [...dimensions, `${sessionDate} >= ?`, `${sessionDate} < ?`].join(" AND ");
  const sessionParams = [...dimensionParams, rangeFrom, rangeTo];
  type TotalsRow = {
    session_count: number; event_count: number; message_count: number; tool_call_count: number;
    error_count: number; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null;
    token_session_count: number; timestamped_event_count: number;
  };
  const totals = db.prepare(`SELECT COUNT(*) session_count, COALESCE(SUM(m.event_count),0) event_count,
    COALESCE(SUM(m.message_count),0) message_count, COALESCE(SUM(m.tool_call_count),0) tool_call_count,
    COALESCE(SUM(m.error_count),0) error_count, SUM(CASE WHEN m.token_recorded=1 THEN m.input_tokens END) input_tokens,
    SUM(CASE WHEN m.token_recorded=1 THEN m.output_tokens END) output_tokens,
    SUM(CASE WHEN m.token_recorded=1 THEN m.total_tokens END) total_tokens,
    COALESCE(SUM(m.token_recorded),0) token_session_count,
    COALESCE(SUM(m.timestamped_event_count),0) timestamped_event_count
    FROM sessions s JOIN session_metrics m ON m.session_id=s.id WHERE ${sessionWhere}`).get(...sessionParams) as TotalsRow;

  type BreakdownRow = { value: string; session_count: number; event_count: number; tool_call_count: number; error_count: number; total_tokens: number | null; token_session_count: number };
  const sourceLabels = new Map((db.prepare("SELECT id,label FROM sources").all() as Array<{ id: string; label: string }>).map((row) => [row.id, row.label]));
  const breakdown = (column: "s.provider" | "s.project_path" | "s.model") => {
    const rows = db.prepare(`SELECT ${column} value, COUNT(*) session_count, COALESCE(SUM(m.event_count),0) event_count,
      COALESCE(SUM(m.tool_call_count),0) tool_call_count, COALESCE(SUM(m.error_count),0) error_count,
      SUM(CASE WHEN m.token_recorded=1 THEN m.total_tokens END) total_tokens,
      COALESCE(SUM(m.token_recorded),0) token_session_count
      FROM sessions s JOIN session_metrics m ON m.session_id=s.id WHERE ${sessionWhere} AND ${column} IS NOT NULL
      GROUP BY ${column} ORDER BY event_count DESC, value LIMIT 100`).all(...sessionParams) as BreakdownRow[];
    return rows.map((row): AnalyticsBreakdown => ({ value: row.value,
      label: column === "s.provider" ? sourceLabels.get(row.value) || row.value : row.value,
      sessionCount: row.session_count, eventCount: row.event_count, toolCallCount: row.tool_call_count,
      errorCount: row.error_count, totalTokens: row.token_session_count ? row.total_tokens : null,
      tokenSessionCount: row.token_session_count }));
  };

  const activityWhere = [...dimensions, "sa.bucket_start_utc >= ?", "sa.bucket_start_utc < ?"].join(" AND ");
  const activityRows = db.prepare(`SELECT sa.bucket_start_utc bucket_start, SUM(sa.event_count) event_count,
    SUM(sa.tool_call_count) tool_call_count, SUM(sa.error_count) error_count
    FROM session_activity sa JOIN sessions s ON s.id=sa.session_id
    WHERE ${activityWhere} GROUP BY sa.bucket_start_utc ORDER BY sa.bucket_start_utc`)
    .all(...dimensionParams, rangeFrom, rangeTo) as Array<{ bucket_start: string; event_count: number; tool_call_count: number; error_count: number }>;
  const activityByDay = new Map<string, { eventCount: number; toolCallCount: number; errorCount: number }>();
  for (const row of activityRows) {
    const day = localDay(row.bucket_start, timezone);
    const current = activityByDay.get(day) || { eventCount: 0, toolCallCount: 0, errorCount: 0 };
    current.eventCount += row.event_count; current.toolCallCount += row.tool_call_count; current.errorCount += row.error_count;
    activityByDay.set(day, current);
  }
  const tokenRows = db.prepare(`SELECT m.token_timestamp, m.input_tokens, m.output_tokens, m.total_tokens
    FROM session_metrics m JOIN sessions s ON s.id=m.session_id
    WHERE m.token_recorded=1 AND m.token_timestamp >= ? AND m.token_timestamp < ?${dimensions.length ? ` AND ${dimensions.join(" AND ")}` : ""}`)
    .all(rangeFrom, rangeTo, ...dimensionParams) as Array<{ token_timestamp: string; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null }>;
  const tokensByDay = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number; sessionCount: number }>();
  for (const row of tokenRows) {
    const day = localDay(row.token_timestamp, timezone);
    const current = tokensByDay.get(day) || { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessionCount: 0 };
    current.inputTokens += row.input_tokens || 0; current.outputTokens += row.output_tokens || 0; current.totalTokens += row.total_tokens || 0; current.sessionCount += 1;
    tokensByDay.set(day, current);
  }
  const eventWhere = [...dimensions, "e.timestamp >= ?", "e.timestamp < ?", "e.kind='tool_call'", "e.tool_name IS NOT NULL"].join(" AND ");
  const tools = db.prepare(`SELECT e.tool_name name, COUNT(*) count FROM events e JOIN sessions s ON s.id=e.session_id WHERE ${eventWhere} GROUP BY e.tool_name ORDER BY count DESC,name LIMIT 25`)
    .all(...dimensionParams, rangeFrom, rangeTo) as Array<{ name: string; count: number }>;
  const topIds = db.prepare(`SELECT s.id FROM sessions s JOIN session_metrics m ON m.session_id=s.id WHERE ${sessionWhere} ORDER BY m.event_count DESC, ${sessionDate} DESC LIMIT 10`)
    .all(...sessionParams) as Array<{ id: string }>;
  return {
    range: { from: rangeFrom, to: rangeTo, timezone },
    totals: { sessionCount: totals.session_count, eventCount: totals.event_count, messageCount: totals.message_count,
      toolCallCount: totals.tool_call_count, errorCount: totals.error_count,
      inputTokens: totals.token_session_count ? totals.input_tokens : null,
      outputTokens: totals.token_session_count ? totals.output_tokens : null,
      totalTokens: totals.token_session_count ? totals.total_tokens : null,
      tokenSessionCount: totals.token_session_count, timestampedEventCount: totals.timestamped_event_count },
    activity: [...activityByDay].sort(([a], [b]) => a.localeCompare(b)).map(([bucketStart, value]) => ({ bucketStart, ...value })),
    tokens: [...tokensByDay].sort(([a], [b]) => a.localeCompare(b)).map(([bucketStart, value]) => ({ bucketStart, ...value })),
    providers: breakdown("s.provider"), projects: breakdown("s.project_path"), models: breakdown("s.model"), tools,
    topSessions: topIds.flatMap(({ id }) => { const session = getSession(id); const metrics = getSessionMetrics(id); return session && metrics ? [{ session, metrics }] : []; }),
  };
}

export type RecentFilesOptions = {
  providers?: ProviderId[];
  projects?: string[];
  actions?: FileReferenceAction[];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export function recentFiles(options: RecentFilesOptions = {}): RecentFilesResponse {
  ensureDerivedData();
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  const addList = (column: string, values: readonly string[] | undefined) => {
    if (!values?.length) return;
    where.push(`${column} IN (${values.map(() => "?").join(",")})`); params.push(...values);
  };
  addList("s.provider", options.providers); addList("s.project_path", options.projects); addList("fr.action", options.actions);
  if (options.from) { where.push("COALESCE(fr.timestamp,s.updated_at,s.started_at) >= ?"); params.push(options.from); }
  if (options.to) { where.push("COALESCE(fr.timestamp,s.updated_at,s.started_at) < ?"); params.push(options.to); }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(options.limit || 50, 1), 100);
  const offset = Math.max(options.offset || 0, 0);
  const groups = db.prepare(`SELECT fr.path, s.project_path, MAX(COALESCE(fr.timestamp,s.updated_at,s.started_at)) latest_at
    FROM file_references fr JOIN sessions s ON s.id=fr.session_id ${filter}
    GROUP BY fr.path,s.project_path ORDER BY latest_at DESC,fr.path LIMIT ? OFFSET ?`)
    .all(...params, limit + 1, offset) as Array<{ path: string; project_path: string | null; latest_at: string | null }>;
  const visible = groups.slice(0, limit);
  type ReferenceRow = { id: string; event_id: string; session_id: string; provider: ProviderId; session_title: string; project_path: string | null; path: string; action: FileReferenceAction; source: "structured" | "patch"; timestamp: string | null };
  return {
    data: visible.map((group) => {
      const references = db.prepare(`SELECT fr.id,fr.event_id,fr.session_id,s.provider,s.title session_title,s.project_path,
        fr.path,fr.action,fr.source,COALESCE(fr.timestamp,s.updated_at,s.started_at) timestamp
        FROM file_references fr JOIN sessions s ON s.id=fr.session_id
        WHERE fr.path=? AND s.project_path IS ?${where.length ? ` AND ${where.join(" AND ")}` : ""}
        ORDER BY timestamp DESC LIMIT 20`).all(group.path, group.project_path, ...params) as ReferenceRow[];
      return { path: group.path, projectPath: group.project_path, latestAt: group.latest_at,
        references: references.map((row) => ({ id: row.id, eventId: row.event_id, sessionId: row.session_id,
          provider: row.provider, sessionTitle: row.session_title, projectPath: row.project_path, path: row.path,
          action: row.action, source: row.source, timestamp: row.timestamp })) };
    }),
    nextOffset: groups.length > limit ? offset + limit : null,
  };
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
