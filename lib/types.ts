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

export interface SourceAdapter {
  id: ProviderId;
  label: string;
  detect(path: string): Promise<boolean>;
  parse(path: string): AsyncGenerator<ParsedSession | ImportDiagnostic>;
}


