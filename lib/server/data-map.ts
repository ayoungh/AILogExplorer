import "server-only";
import { DATA_CONCEPTS, PROVIDER_DATA_MAP, VISIBLE_DATA_MAP_PROVIDERS, dataConcept } from "@/lib/adapters/data-map";
import type { DataConceptId, DataMapFieldId, DataMapResponse, DataMapSampleResponse, EventKind, ProviderConceptSummary, ProviderId } from "@/lib/types";
import { getDb } from "./db";
import { getEvent } from "./repository";
import { sanitizeSample } from "./sample-preview";

const FIELD_COUNT_COLUMNS: Record<DataMapFieldId, string> = {
  timestamp: "timestamp_count",
  role: "role_count",
  turnId: "turn_id_count",
  callId: "call_id_count",
  parentId: "parent_id_count",
  toolName: "tool_name_count",
  text: "text_count",
  input: "input_count",
  output: "output_count",
  status: "status_count",
  durationMs: "duration_ms_count",
  inputTokens: "input_tokens_count",
  outputTokens: "output_tokens_count",
  totalTokens: "total_tokens_count",
};

type AggregateRow = {
  provider: ProviderId;
  kind: EventKind;
  event_count: number;
  sample_count: number;
  timestamp_count: number;
  role_count: number;
  turn_id_count: number;
  call_id_count: number;
  parent_id_count: number;
  tool_name_count: number;
  text_count: number;
  input_count: number;
  output_count: number;
  status_count: number;
  duration_ms_count: number;
  input_tokens_count: number;
  output_tokens_count: number;
  total_tokens_count: number;
};

type ProviderRow = {
  id: ProviderId;
  label: string;
  status: "ready" | "empty" | "warning";
  note: string | null;
  session_count: number;
  event_count: number;
};

export function ensureDataMapStats() {
  const db = getDb();
  // A long-running dev server may already hold a connection opened before this migration existed.
  // Keeping this idempotent guard here makes the feature hot-reload safe as well as migration safe.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_event_stats (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      timestamp_count INTEGER NOT NULL DEFAULT 0,
      role_count INTEGER NOT NULL DEFAULT 0,
      turn_id_count INTEGER NOT NULL DEFAULT 0,
      call_id_count INTEGER NOT NULL DEFAULT 0,
      parent_id_count INTEGER NOT NULL DEFAULT 0,
      tool_name_count INTEGER NOT NULL DEFAULT 0,
      text_count INTEGER NOT NULL DEFAULT 0,
      input_count INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0,
      status_count INTEGER NOT NULL DEFAULT 0,
      duration_ms_count INTEGER NOT NULL DEFAULT 0,
      input_tokens_count INTEGER NOT NULL DEFAULT 0,
      output_tokens_count INTEGER NOT NULL DEFAULT 0,
      total_tokens_count INTEGER NOT NULL DEFAULT 0,
      sample_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      PRIMARY KEY (session_id, kind)
    );
    CREATE INDEX IF NOT EXISTS session_event_stats_kind_idx ON session_event_stats(kind, session_id);
  `);
  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO session_event_stats (
        session_id, kind, event_count, timestamp_count, role_count, turn_id_count, call_id_count,
        parent_id_count, tool_name_count, text_count, input_count, output_count, status_count,
        duration_ms_count, input_tokens_count, output_tokens_count, total_tokens_count, sample_event_id
      )
      SELECT
        e.session_id, e.kind, COUNT(*),
        SUM(e.timestamp IS NOT NULL), SUM(e.role IS NOT NULL), SUM(e.turn_id IS NOT NULL),
        SUM(e.call_id IS NOT NULL), SUM(e.parent_id IS NOT NULL), SUM(e.tool_name IS NOT NULL),
        SUM(e.text IS NOT NULL), SUM(e.input_json IS NOT NULL), SUM(e.output_json IS NOT NULL),
        SUM(e.status IS NOT NULL), SUM(e.duration_ms IS NOT NULL), SUM(e.input_tokens IS NOT NULL),
        SUM(e.output_tokens IS NOT NULL), SUM(e.total_tokens IS NOT NULL), MIN(e.id)
      FROM events e
      LEFT JOIN session_event_stats st ON st.session_id=e.session_id AND st.kind=e.kind
      WHERE st.session_id IS NULL
      GROUP BY e.session_id, e.kind
    `).run();
  })();
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 1_000) / 10 : 0;
}

export function getDataMap(): DataMapResponse {
  ensureDataMapStats();
  const db = getDb();
  const placeholders = VISIBLE_DATA_MAP_PROVIDERS.map(() => "?").join(",");
  const providers = db.prepare(`
    SELECT so.id, so.label, so.status, so.note, COUNT(se.id) session_count,
      COALESCE(SUM(se.event_count), 0) event_count
    FROM sources so LEFT JOIN sessions se ON se.provider=so.id
    WHERE so.id IN (${placeholders})
    GROUP BY so.id
  `).all(...VISIBLE_DATA_MAP_PROVIDERS) as ProviderRow[];
  const byProvider = new Map(providers.map((provider) => [provider.id, provider]));
  const orderedProviders = VISIBLE_DATA_MAP_PROVIDERS.map((id) => byProvider.get(id)).filter((value): value is ProviderRow => Boolean(value));
  const aggregates = db.prepare(`
    SELECT s.provider, st.kind, SUM(st.event_count) event_count, COUNT(st.sample_event_id) sample_count,
      SUM(st.timestamp_count) timestamp_count, SUM(st.role_count) role_count,
      SUM(st.turn_id_count) turn_id_count, SUM(st.call_id_count) call_id_count,
      SUM(st.parent_id_count) parent_id_count, SUM(st.tool_name_count) tool_name_count,
      SUM(st.text_count) text_count, SUM(st.input_count) input_count, SUM(st.output_count) output_count,
      SUM(st.status_count) status_count, SUM(st.duration_ms_count) duration_ms_count,
      SUM(st.input_tokens_count) input_tokens_count, SUM(st.output_tokens_count) output_tokens_count,
      SUM(st.total_tokens_count) total_tokens_count
    FROM session_event_stats st JOIN sessions s ON s.id=st.session_id
    GROUP BY s.provider, st.kind
  `).all() as AggregateRow[];
  const aggregateByProvider = new Map<string, AggregateRow>();
  for (const row of aggregates) aggregateByProvider.set(`${row.provider}:${row.kind}`, row);

  const indexedProviderCount = orderedProviders.filter((provider) => provider.session_count > 0).length;
  const concepts = DATA_CONCEPTS.map((concept) => {
    const providerSummaries = orderedProviders.map((provider) => {
      const rows = concept.kinds.map((kind) => aggregateByProvider.get(`${provider.id}:${kind}`)).filter((row): row is AggregateRow => Boolean(row));
      const eventCount = rows.reduce((total, row) => total + row.event_count, 0);
      const sampleCount = Math.min(25, rows.reduce((total, row) => total + row.sample_count, 0));
      const catalog = PROVIDER_DATA_MAP[provider.id][concept.id];
      const fieldCoverage: Partial<Record<DataMapFieldId, number>> = {};
      for (const fieldId of concept.fields) {
        const column = FIELD_COUNT_COLUMNS[fieldId] as keyof AggregateRow;
        const populated = rows.reduce((total, row) => total + Number(row[column] || 0), 0);
        fieldCoverage[fieldId] = percent(populated, eventCount);
      }
      const status: ProviderConceptSummary["status"] = eventCount > 0
        ? "recorded"
        : provider.status === "warning" && provider.session_count === 0
          ? "export-required"
          : catalog
            ? "not-observed"
            : "unsupported";
      return {
        provider: provider.id,
        label: provider.label,
        status,
        eventCount,
        providerEventShare: percent(eventCount, provider.event_count),
        nativeRecords: catalog?.nativeRecords || [],
        fieldMappings: catalog?.fields || [],
        fieldCoverage,
        sampleCount,
      };
    });
    const providerCount = providerSummaries.filter((provider) => provider.eventCount > 0).length;
    return {
      id: concept.id,
      label: concept.label,
      description: concept.description,
      eventCount: providerSummaries.reduce((total, provider) => total + provider.eventCount, 0),
      providerCount,
      indexedProviderCount,
      providerCoverage: percent(providerCount, indexedProviderCount),
      providers: providerSummaries,
    };
  });
  return {
    concepts,
    totalEvents: orderedProviders.reduce((total, provider) => total + provider.event_count, 0),
    totalSessions: orderedProviders.reduce((total, provider) => total + provider.session_count, 0),
  };
}

export function getDataMapSample(provider: ProviderId, conceptId: DataConceptId, requestedIndex: number): DataMapSampleResponse | null {
  ensureDataMapStats();
  const concept = dataConcept(conceptId);
  const placeholders = concept.kinds.map(() => "?").join(",");
  const candidates = getDb().prepare(`
    SELECT st.sample_event_id, st.kind
    FROM session_event_stats st JOIN sessions s ON s.id=st.session_id
    WHERE s.provider=? AND s.available=1 AND st.kind IN (${placeholders}) AND st.sample_event_id IS NOT NULL
    ORDER BY COALESCE(s.updated_at, s.started_at) DESC, s.id, st.kind
    LIMIT 25
  `).all(provider, ...concept.kinds) as Array<{ sample_event_id: string; kind: EventKind }>;
  const index = Math.trunc(requestedIndex);
  if (index < 0 || index >= candidates.length) return null;
  const event = getEvent(candidates[index].sample_event_id);
  if (!event?.raw) return null;
  const normalizedValue = Object.fromEntries([
    ["timestamp", event.timestamp], ["role", event.role], ["turnId", event.turnId],
    ["callId", event.callId], ["parentId", event.parentId], ["toolName", event.toolName],
    ["text", event.text], ["input", event.input], ["output", event.output], ["status", event.status],
    ["durationMs", event.durationMs], ["inputTokens", event.inputTokens],
    ["outputTokens", event.outputTokens], ["totalTokens", event.totalTokens],
  ].filter(([, value]) => value != null));
  const normalized = sanitizeSample(normalizedValue);
  const raw = sanitizeSample(event.raw);
  return {
    provider,
    concept: conceptId,
    index,
    total: candidates.length,
    kind: event.kind,
    normalized: normalized.sample as DataMapSampleResponse["normalized"],
    sample: raw.sample,
    truncated: normalized.truncated || raw.truncated,
  };
}
