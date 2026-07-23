import {
  BrainCircuit,
  CircleAlert,
  CircleHelp,
  Gauge,
  Info,
  Paperclip,
  Tags,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { EventKind, ProviderId } from "@/lib/types";
import { ProviderMark } from "./provider-mark";

const eventIcons = {
  user_message: UserRound,
  reasoning: BrainCircuit,
  tool_call: Wrench,
  tool_result: Wrench,
  system: Info,
  usage: Gauge,
  error: CircleAlert,
  attachment: Paperclip,
  metadata: Tags,
  unknown: CircleHelp,
} satisfies Record<Exclude<EventKind, "assistant_message">, LucideIcon>;

export function EventIcon({ kind, provider }: { kind: EventKind; provider: ProviderId }) {
  if (kind === "assistant_message") return <ProviderMark provider={provider} size="small" />;
  const Icon = eventIcons[kind];
  return <Icon size={kind === "error" ? 15 : 14} />;
}
