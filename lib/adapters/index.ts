import type { SourceAdapter } from "@/lib/types";
import { ClaudeJsonlAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { exportAdapter } from "./exports";

export const claudeCodeAdapter = new ClaudeJsonlAdapter(false);
export const claudeDesktopAdapter = new ClaudeJsonlAdapter(true);

export const adapters: SourceAdapter[] = [codexAdapter, claudeDesktopAdapter, claudeCodeAdapter, cursorAdapter, exportAdapter];

export async function detectAdapter(filePath: string, hint?: string) {
  if (hint === "claude-desktop" && await claudeDesktopAdapter.detect(filePath)) return claudeDesktopAdapter;
  for (const adapter of adapters) if (await adapter.detect(filePath)) return adapter;
  return null;
}

export { codexAdapter, cursorAdapter, exportAdapter };

