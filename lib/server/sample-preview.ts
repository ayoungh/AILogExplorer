const SENSITIVE_KEY = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|auth|cookie|password|passwd|secret|private[_-]?key|encrypted[_-]?content)($|[_-])/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const MAC_HOME = /\/Users\/[^/\s"']+/g;
const WINDOWS_HOME = /[A-Z]:\\Users\\[^\\\s"']+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

type PreviewState = {
  truncated: boolean;
  nodes: number;
  stringBudget: number;
  maxNodes: number;
  maxString: number;
  maxArray: number;
  maxObject: number;
};

function safeString(value: string, state: PreviewState) {
  let result = value
    .replace(EMAIL, "[redacted email]")
    .replace(MAC_HOME, "~")
    .replace(WINDOWS_HOME, "~")
    .replace(BEARER, "Bearer [redacted]");
  const allowed = Math.max(0, Math.min(state.maxString, state.stringBudget));
  if (result.length > allowed) {
    result = `${result.slice(0, Math.max(0, allowed - 1))}…`;
    state.truncated = true;
  }
  state.stringBudget -= result.length;
  return result;
}

function visit(value: unknown, state: PreviewState, depth: number, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) {
    state.truncated = true;
    return key.toLowerCase().includes("encrypted") ? "[opaque encrypted content]" : "[redacted]";
  }
  state.nodes += 1;
  if (state.nodes > state.maxNodes) {
    state.truncated = true;
    return "[truncated]";
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return safeString(value, state);
  if (depth >= 6) {
    state.truncated = true;
    return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
  }
  if (Array.isArray(value)) {
    if (value.length > state.maxArray) state.truncated = true;
    const result = value.slice(0, state.maxArray).map((item) => visit(item, state, depth + 1));
    if (value.length > state.maxArray) result.push(`[${value.length - state.maxArray} more items]`);
    return result;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > state.maxObject) state.truncated = true;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of entries.slice(0, state.maxObject)) {
      result[childKey] = visit(childValue, state, depth + 1, childKey);
    }
    if (entries.length > state.maxObject) result["…"] = `${entries.length - state.maxObject} more fields`;
    return result;
  }
  return String(value);
}

function createPreview(value: unknown, compact = false) {
  const state: PreviewState = {
    truncated: false,
    nodes: 0,
    stringBudget: compact ? 900 : 2_600,
    maxNodes: compact ? 60 : 120,
    maxString: compact ? 120 : 240,
    maxArray: compact ? 2 : 5,
    maxObject: compact ? 12 : 24,
  };
  return { sample: visit(value, state, 0), truncated: state.truncated };
}

export function sanitizeSample(value: unknown) {
  let preview = createPreview(value);
  if (Buffer.byteLength(JSON.stringify(preview.sample), "utf8") > 4_096) {
    preview = createPreview(value, true);
    preview.truncated = true;
  }
  if (Buffer.byteLength(JSON.stringify(preview.sample), "utf8") > 4_096) {
    return { sample: { preview: "[Sample structure exceeds the 4 KiB preview limit]" }, truncated: true };
  }
  return preview;
}
