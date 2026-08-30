export const PROVIDER_IDS = [
  "claude-code",
  "claude-desktop",
  "codex",
  "cursor",
  "chatgpt",
  "claude-export",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const EVENT_KINDS = [
  "user_message",
  "assistant_message",
  "reasoning",
  "tool_call",
  "tool_result",
  "system",
  "usage",
  "error",
  "attachment",
  "metadata",
  "unknown",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const DATA_CONCEPT_IDS = [
  "messages",
  "reasoning",
  "tool-calls",
  "tool-results",
  "usage-tokens",
  "errors",
  "attachments",
  "system-context",
  "metadata-unknown",
] as const;

export type DataConceptId = (typeof DATA_CONCEPT_IDS)[number];

export const DATA_MAP_FIELD_IDS = [
  "timestamp", "role", "turnId", "callId", "parentId", "toolName", "text",
  "input", "output", "status", "durationMs", "inputTokens", "outputTokens", "totalTokens",
] as const;

export type DataMapFieldId = (typeof DATA_MAP_FIELD_IDS)[number];

export type NativeFieldMapping = {
  field: DataMapFieldId;
  sourcePaths: string[];
  type: "string" | "number" | "object" | "array" | "mixed";
};

export type ProviderConceptSummary = {
  provider: ProviderId;
  label: string;
  status: "recorded" | "not-observed" | "unsupported" | "export-required";
  eventCount: number;
  providerEventShare: number;
  nativeRecords: string[];
  fieldMappings: NativeFieldMapping[];
  fieldCoverage: Partial<Record<DataMapFieldId, number>>;
  sampleCount: number;
};

export type DataConceptSummary = {
  id: DataConceptId;
  label: string;
  description: string;
  eventCount: number;
  providerCount: number;
  indexedProviderCount: number;
  providerCoverage: number;
  providers: ProviderConceptSummary[];
};

export type DataMapResponse = {
  concepts: DataConceptSummary[];
  totalEvents: number;
  totalSessions: number;
};

export type DataMapSampleResponse = {
  provider: ProviderId;
  concept: DataConceptId;
  index: number;
  total: number;
  kind: EventKind;
  normalized: Partial<Record<DataMapFieldId, unknown>>;
  sample: unknown;
  truncated: boolean;
};

export type ProviderSummary = {
  id: ProviderId;
  label: string;
  sessionCount: number;
  eventCount: number;
  status: "ready" | "empty" | "warning";
  note?: string;
  diagnosticCount?: number;
};

export type NormalizedSession = {
  id: string;
  provider: ProviderId;
  externalId: string;
  title: string;
  projectPath: string | null;
  sourcePath: string;
  startedAt: string | null;
  updatedAt: string | null;
  model: string | null;
  available: boolean;
  eventCount: number;
  diagnosticsCount?: number;
};

export type NormalizedEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string | null;
  kind: EventKind;
  role: string | null;
  turnId: string | null;
  callId: string | null;
  parentId: string | null;
  toolName: string | null;
  text: string | null;
  input: unknown;
  output: unknown;
  status: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  raw?: unknown;
  rawRecordCount?: number;
};

export type EventSummary = Omit<NormalizedEvent, "input" | "output" | "raw"> & {
  hasInput: boolean;
  hasOutput: boolean;
  rawBytes: number;
  rawRecordCount: number;
};

export type EventContentPart = "input" | "output" | "raw";

export type EventContentPreview = {
  part: EventContentPart;
  text: string;
  truncated: boolean;
  bytes: number | null;
};

export type EventPageResponse = {
  session: NormalizedSession;
  data: EventSummary[];
  total: number;
  offset: number;
  previousOffset: number | null;
  nextOffset: number | null;
  anchorFound: boolean;
};

export type ParsedSession = Omit<NormalizedSession, "eventCount" | "diagnosticsCount"> & {
  metadata?: unknown;
  events: ParsedEvent[];
};

export type ParsedEvent = Omit<NormalizedEvent, "id" | "sessionId" | "raw"> & {
  externalId?: string;
  raw: unknown;
  searchableText?: string;
  canonicalKey?: string;
};

export type ImportDiagnostic = {
  provider?: ProviderId;
  sourcePath: string;
  severity: "info" | "warning" | "error";
  message: string;
  line?: number;
};

export type JobRecord = {
  id: string;
  kind: "scan" | "import";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  processedFiles: number;
  totalFiles: number;
  processedEvents: number;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  diagnosticCount?: number;
  diagnostics?: ImportDiagnostic[];
};

export type OverviewResponse = {
  providers: ProviderSummary[];
  totalSessions: number;
  totalEvents: number;
  lastScanAt: string | null;
  activeJob: JobRecord | null;
  encryptedChatGptCache: boolean;
};

export type SessionMetrics = {
  sessionId: string;
  observedStartedAt: string | null;
  observedEndedAt: string | null;
  durationMs: number | null;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  errorCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokenRecorded: boolean;
  tokenTimestamp: string | null;
  timestampedEventCount: number;
  eventCount: number;
};

export type SearchSort = "relevance" | "recent" | "sequence";

export type SearchFacetValue = {
  value: string;
  label: string;
  count: number;
};

export type SearchFacets = {
  providers: SearchFacetValue[];
  projects: SearchFacetValue[];
  models: SearchFacetValue[];
  kinds: SearchFacetValue[];
};

export type SearchResult = EventSummary & {
  provider: ProviderId;
  sessionTitle: string;
  projectPath: string | null;
  model: string | null;
  sessionStartedAt: string | null;
  sessionUpdatedAt: string | null;
  snippet: string;
};

export type SearchResponse = {
  data: SearchResult[];
  total: number;
  nextOffset: number | null;
  facets: SearchFacets;
};

export type AnalyticsBreakdown = {
  value: string;
  label: string;
  sessionCount: number;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  totalTokens: number | null;
  tokenSessionCount: number;
};

export type AnalyticsActivityBucket = {
  bucketStart: string;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
};

export type AnalyticsTokenBucket = {
  bucketStart: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionCount: number;
};

export type AnalyticsTopSession = {
  session: NormalizedSession;
  metrics: SessionMetrics;
};

export type AnalyticsResponse = {
  range: { from: string; to: string; timezone: string };
  totals: {
    sessionCount: number;
    eventCount: number;
    messageCount: number;
    toolCallCount: number;
    errorCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    tokenSessionCount: number;
    timestampedEventCount: number;
  };
  activity: AnalyticsActivityBucket[];
  tokens: AnalyticsTokenBucket[];
  providers: AnalyticsBreakdown[];
  projects: AnalyticsBreakdown[];
  models: AnalyticsBreakdown[];
  tools: Array<{ name: string; count: number }>;
  topSessions: AnalyticsTopSession[];
};

export type FileReferenceAction = "read" | "write" | "create" | "delete" | "unknown";

export type FileReference = {
  id: string;
  eventId: string;
  sessionId: string;
  provider: ProviderId;
  sessionTitle: string;
  projectPath: string | null;
  path: string;
  action: FileReferenceAction;
  source: "structured" | "patch";
  timestamp: string | null;
};

export type RecentFileGroup = {
  path: string;
  projectPath: string | null;
  latestAt: string | null;
  references: FileReference[];
};

export type RecentFilesResponse = {
  data: RecentFileGroup[];
  nextOffset: number | null;
};

export interface SourceAdapter {
  id: ProviderId;
  label: string;
  detect(path: string): Promise<boolean>;
  parse(path: string): AsyncGenerator<ParsedSession | ImportDiagnostic>;
}
