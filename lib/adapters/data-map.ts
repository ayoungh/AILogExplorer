import type { DataConceptId, DataMapFieldId, EventKind, NativeFieldMapping, ProviderId } from "@/lib/types";

export type DataConceptDefinition = {
  id: DataConceptId;
  label: string;
  description: string;
  kinds: EventKind[];
  fields: DataMapFieldId[];
};

export const DATA_CONCEPTS: DataConceptDefinition[] = [
  { id: "messages", label: "Messages", description: "Prompts and responses exchanged between the user and the model.", kinds: ["user_message", "assistant_message"], fields: ["timestamp", "role", "turnId", "parentId", "text"] },
  { id: "reasoning", label: "Reasoning", description: "Model reasoning, thinking blocks, or summaries recorded while producing a response.", kinds: ["reasoning"], fields: ["timestamp", "role", "turnId", "text", "durationMs"] },
  { id: "tool-calls", label: "Tool calls", description: "Requests from the model to use a tool or function, including its name, arguments, and call identifier.", kinds: ["tool_call"], fields: ["toolName", "callId", "input", "status", "timestamp", "turnId", "role", "durationMs"] },
  { id: "tool-results", label: "Tool results", description: "Outputs returned by tools, including success or error state and links back to calls when available.", kinds: ["tool_result"], fields: ["toolName", "callId", "output", "status", "durationMs", "timestamp", "turnId", "role", "text"] },
  { id: "usage-tokens", label: "Usage & tokens", description: "Token counts, rate-limit details, and other recorded usage information.", kinds: ["usage"], fields: ["timestamp", "turnId", "input", "inputTokens", "outputTokens", "totalTokens"] },
  { id: "errors", label: "Errors", description: "Failures, aborted turns, tool errors, and other recorded exceptions.", kinds: ["error"], fields: ["timestamp", "turnId", "text", "status", "input", "output"] },
  { id: "attachments", label: "Attachments", description: "Files, images, and other content attached to a conversation or event.", kinds: ["attachment"], fields: ["timestamp", "role", "text", "input"] },
  { id: "system-context", label: "System context", description: "System prompts, working context, environment state, and session-level instructions.", kinds: ["system"], fields: ["timestamp", "role", "turnId", "text", "input"] },
  { id: "metadata-unknown", label: "Metadata & unknown", description: "Provider metadata and records that do not yet map cleanly to another shared concept.", kinds: ["metadata", "unknown"], fields: ["timestamp", "role", "turnId", "callId", "toolName", "text", "input", "status", "durationMs"] },
];

export const VISIBLE_DATA_MAP_PROVIDERS: ProviderId[] = ["claude-code", "claude-desktop", "codex", "cursor", "chatgpt"];

type ProviderConceptMapping = { nativeRecords: string[]; fields: NativeFieldMapping[] };
type ProviderMappings = Partial<Record<DataConceptId, ProviderConceptMapping>>;

const field = (name: DataMapFieldId, type: NativeFieldMapping["type"], ...sourcePaths: string[]): NativeFieldMapping => ({ field: name, type, sourcePaths });

const claudeMessage = [
  field("timestamp", "string", "timestamp", "_audit_timestamp"),
  field("role", "string", "type", "message.role"),
  field("turnId", "string", "promptId"),
  field("parentId", "string", "parentUuid"),
  field("text", "mixed", "message.content", "message.content[].text"),
];

const claude: ProviderMappings = {
  messages: { nativeRecords: ["user", "assistant", "message.content[].text"], fields: claudeMessage },
  reasoning: { nativeRecords: ["message.content[].thinking"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("role", "string", "type"), field("turnId", "string", "promptId"), field("text", "string", "message.content[].thinking")] },
  "tool-calls": { nativeRecords: ["message.content[].tool_use"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("role", "string", "type"), field("turnId", "string", "promptId"), field("callId", "string", "message.content[].id"), field("toolName", "string", "message.content[].name"), field("input", "object", "message.content[].input")] },
  "tool-results": { nativeRecords: ["message.content[].tool_result"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("role", "string", "type"), field("turnId", "string", "promptId"), field("callId", "string", "message.content[].tool_use_id"), field("text", "mixed", "message.content[].content"), field("output", "mixed", "message.content[].content"), field("status", "string", "message.content[].is_error")] },
  errors: { nativeRecords: ["system.error", "tool_result.is_error"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("text", "mixed", "content", "message.content[].content"), field("status", "string", "level", "subtype", "message.content[].is_error")] },
  attachments: { nativeRecords: ["attachment", "message.content[].image"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("role", "string", "type"), field("text", "string", "attachment.name", "message.content[].type"), field("input", "object", "attachment", "message.content[].source")] },
  "system-context": { nativeRecords: ["system"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("text", "mixed", "content"), field("input", "mixed", "content")] },
  "metadata-unknown": { nativeRecords: ["queue-operation", "custom-title", "ai-title"], fields: [field("timestamp", "string", "timestamp", "_audit_timestamp"), field("text", "string", "type", "title", "customTitle"), field("input", "mixed", "content")] },
};

const codex: ProviderMappings = {
  messages: { nativeRecords: ["event_msg.user_message", "response_item.message"], fields: [field("timestamp", "string", "timestamp"), field("role", "string", "payload.role", "payload.type"), field("turnId", "string", "payload.turn_id"), field("text", "mixed", "payload.message", "payload.content") ] },
  reasoning: { nativeRecords: ["response_item.reasoning", "event_msg.agent_reasoning"], fields: [field("timestamp", "string", "timestamp"), field("role", "string", "payload.role"), field("turnId", "string", "payload.turn_id"), field("text", "mixed", "payload.summary", "payload.text"), field("input", "object", "payload.encrypted_content")] },
  "tool-calls": { nativeRecords: ["response_item.function_call", "response_item.custom_tool_call", "response_item.web_search_call"], fields: [field("timestamp", "string", "timestamp"), field("role", "string", "payload.role"), field("turnId", "string", "payload.turn_id"), field("callId", "string", "payload.call_id", "payload.id"), field("toolName", "string", "payload.name", "payload.type"), field("input", "mixed", "payload.arguments", "payload.input", "payload.action"), field("status", "string", "payload.status")] },
  "tool-results": { nativeRecords: ["response_item.function_call_output", "response_item.custom_tool_call_output", "event_msg.*_end"], fields: [field("timestamp", "string", "timestamp"), field("turnId", "string", "payload.turn_id"), field("callId", "string", "payload.call_id", "payload.id"), field("toolName", "string", "payload.name", "payload.type"), field("text", "mixed", "payload.output", "payload.message"), field("output", "mixed", "payload.output", "payload"), field("status", "string", "payload.status"), field("durationMs", "number", "payload.duration_ms")] },
  "usage-tokens": { nativeRecords: ["event_msg.token_count"], fields: [field("timestamp", "string", "timestamp"), field("turnId", "string", "payload.turn_id"), field("input", "object", "payload.rate_limits"), field("inputTokens", "number", "payload.info.total_token_usage.input_tokens", "payload.info.last_token_usage.input_tokens"), field("outputTokens", "number", "payload.info.total_token_usage.output_tokens", "payload.info.last_token_usage.output_tokens"), field("totalTokens", "number", "payload.info.total_token_usage.total_tokens", "payload.info.last_token_usage.total_tokens")] },
  errors: { nativeRecords: ["event_msg.error", "event_msg.turn_aborted"], fields: [field("timestamp", "string", "timestamp"), field("turnId", "string", "payload.turn_id"), field("text", "string", "payload.message", "payload.reason"), field("status", "string", "payload.type")] },
  "system-context": { nativeRecords: ["turn_context", "world_state"], fields: [field("timestamp", "string", "timestamp"), field("turnId", "string", "payload.turn_id"), field("text", "string", "payload.type"), field("input", "object", "payload")] },
  "metadata-unknown": { nativeRecords: ["session_meta", "event_msg.*", "response_item.*"], fields: [field("timestamp", "string", "timestamp"), field("turnId", "string", "payload.turn_id"), field("callId", "string", "payload.call_id", "payload.id"), field("toolName", "string", "payload.name"), field("text", "string", "payload.type"), field("input", "object", "payload"), field("status", "string", "payload.status"), field("durationMs", "number", "payload.duration_ms")] },
};

const cursor: ProviderMappings = {
  messages: { nativeRecords: ["cursorDiskKV.bubble"], fields: [field("timestamp", "mixed", "createdAt"), field("role", "number", "type"), field("text", "string", "text", "richText")] },
  reasoning: { nativeRecords: ["bubble.thinking", "bubble.allThinkingBlocks"], fields: [field("timestamp", "mixed", "createdAt"), field("role", "number", "type"), field("text", "mixed", "thinking", "allThinkingBlocks"), field("durationMs", "number", "thinkingDurationMs")] },
  "tool-calls": { nativeRecords: ["bubble.toolFormerData"], fields: [field("timestamp", "mixed", "createdAt"), field("role", "number", "type"), field("toolName", "string", "toolFormerData.name", "capabilityType"), field("input", "object", "toolFormerData")] },
  "tool-results": { nativeRecords: ["bubble.toolResults", "bubble.capabilitiesRan"], fields: [field("timestamp", "mixed", "createdAt"), field("role", "number", "type"), field("output", "mixed", "toolResults", "capabilitiesRan"), field("status", "string", "errorDetails")] },
  errors: { nativeRecords: ["bubble.errorDetails"], fields: [field("timestamp", "mixed", "createdAt"), field("text", "mixed", "errorDetails"), field("status", "string", "errorDetails")] },
};

const chatgpt: ProviderMappings = {
  messages: { nativeRecords: ["mapping[].message"], fields: [field("timestamp", "number", "message.create_time"), field("role", "string", "message.author.role"), field("text", "mixed", "message.content.parts", "message.content.text")] },
  "tool-results": { nativeRecords: ["mapping[].message.author.role=tool"], fields: [field("timestamp", "number", "message.create_time"), field("role", "string", "message.author.role"), field("toolName", "string", "message.author.name"), field("text", "mixed", "message.content.parts", "message.content"), field("output", "object", "message.content")] },
  "metadata-unknown": { nativeRecords: ["mapping[] without message"], fields: [field("text", "string", "node type"), field("input", "object", "mapping[]")] },
};

export const PROVIDER_DATA_MAP: Record<ProviderId, ProviderMappings> = {
  "claude-code": claude,
  "claude-desktop": claude,
  codex,
  cursor,
  chatgpt,
  "claude-export": {},
};

export function dataConcept(id: DataConceptId) {
  return DATA_CONCEPTS.find((concept) => concept.id === id)!;
}
