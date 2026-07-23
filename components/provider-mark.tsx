import type { ProviderId } from "@/lib/types";

const initials: Record<ProviderId, string> = {
  "claude-code": "C",
  "claude-desktop": "C",
  codex: "◎",
  cursor: "◆",
  chatgpt: "⌁",
  "claude-export": "C",
};

export function ProviderMark({ provider, size = "medium" }: { provider: ProviderId; size?: "small" | "medium" }) {
  return <span aria-hidden="true" className={`provider-mark provider-${provider} provider-mark-${size}`}>{initials[provider]}</span>;
}


