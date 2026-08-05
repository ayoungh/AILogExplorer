import type { EventKind } from "@/lib/types";

export const EVENT_PAGE_SIZE = 200;

export const CONVERSATION_KINDS: EventKind[] = ["user_message", "assistant_message", "tool_call", "tool_result"];

export const FILTER_GROUPS: Array<{ id: string; label: string; kinds: EventKind[] }> = [
  { id: "all", label: "All events", kinds: [] },
  { id: "messages", label: "Messages", kinds: ["user_message", "assistant_message"] },
  { id: "tools", label: "Tool calls", kinds: ["tool_call", "tool_result"] },
  { id: "reasoning", label: "Reasoning", kinds: ["reasoning"] },
  { id: "system", label: "System", kinds: ["system", "metadata", "usage", "error", "attachment", "unknown"] },
];

export function eventKindsForFilter(filter: string) {
  return FILTER_GROUPS.find((group) => group.id === filter)?.kinds || FILTER_GROUPS[0].kinds;
}
