import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventIcon } from "@/components/event-icon";
import { ProviderMark } from "@/components/provider-mark";
import { PROVIDER_IDS, type EventKind, type ProviderId } from "@/lib/types";

const expectedBrands = {
  "claude-code": "claude",
  "claude-desktop": "claude",
  codex: "openai",
  cursor: "cursor",
  chatgpt: "openai",
  "claude-export": "claude",
} satisfies Record<ProviderId, "claude" | "cursor" | "openai">;

describe("provider branding", () => {
  it("renders an exhaustive SVG brand mark for every provider", () => {
    for (const provider of PROVIDER_IDS) {
      const markup = renderToStaticMarkup(<ProviderMark provider={provider} />);

      expect(markup).toContain("<svg");
      expect(markup).toContain(`data-brand="${expectedBrands[provider]}"`);
      expect(markup).not.toMatch(/>(?:C|◎|◆|⌁)</);
    }
  });

  it("preserves the public size variants", () => {
    expect(renderToStaticMarkup(<ProviderMark provider="cursor" size="small" />)).toContain("provider-mark-small");
    expect(renderToStaticMarkup(<ProviderMark provider="cursor" size="medium" />)).toContain("provider-mark-medium");
  });
});

describe("timeline event icons", () => {
  it("uses the active provider mark for assistant events", () => {
    const markup = renderToStaticMarkup(<EventIcon kind="assistant_message" provider="codex" />);

    expect(markup).toContain('data-brand="openai"');
  });

  it("uses semantic SVG icons instead of initials for non-assistant events", () => {
    const kinds = [
      "user_message",
      "reasoning",
      "tool_call",
      "tool_result",
      "system",
      "usage",
      "error",
      "attachment",
      "metadata",
      "unknown",
    ] satisfies Array<Exclude<EventKind, "assistant_message">>;

    for (const kind of kinds) {
      const markup = renderToStaticMarkup(<EventIcon kind={kind} provider="claude-code" />);

      expect(markup).toContain("<svg");
      expect(markup).not.toMatch(/>(?:U|R|S|A|M)</);
    }
  });
});
