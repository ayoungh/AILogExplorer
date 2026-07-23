import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { EventKind, ParsedEvent, ProviderId } from "@/lib/types";

export function shortHash(value: unknown) {
  return createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function safeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function event(input: Partial<ParsedEvent> & Pick<ParsedEvent, "kind" | "sequence" | "raw">): ParsedEvent {
  return {
    sequence: input.sequence,
    timestamp: input.timestamp ?? null,
    kind: input.kind,
    role: input.role ?? null,
    turnId: input.turnId ?? null,
    callId: input.callId ?? null,
    parentId: input.parentId ?? null,
    toolName: input.toolName ?? null,
    text: input.text ?? null,
    input: input.input ?? null,
    output: input.output ?? null,
    status: input.status ?? null,
    durationMs: input.durationMs ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    externalId: input.externalId,
    raw: input.raw,
    searchableText: input.searchableText,
    canonicalKey: input.canonicalKey,
  };
}

export function roleKind(role: string | undefined | null): EventKind {
  if (role === "user" || role === "human") return "user_message";
  if (role === "assistant" || role === "agent") return "assistant_message";
  return "system";
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const item = content as Record<string, unknown>;
    if (typeof item.text === "string") return item.text;
    if (typeof item.thinking === "string") return item.thinking;
    if (item.content !== undefined && item.content !== content) return textFromContent(item.content);
    return JSON.stringify(content);
  }
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const item = part as Record<string, unknown>;
    return String(item.text ?? item.content ?? item.thinking ?? "");
  }).filter(Boolean).join("\n");
}

export async function* jsonLines(filePath: string) {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let line = 0;
  for await (const value of reader) {
    line += 1;
    if (!value.trim()) continue;
    try {
      yield { line, value: JSON.parse(value) as Record<string, unknown> };
    } catch (error) {
      yield { line, error: error instanceof Error ? error.message : "Invalid JSON" };
    }
  }
}

export function filenameId(filePath: string) {
  return path.basename(filePath).replace(/\.(jsonl|json|data|sqlite|db|vscdb)$/i, "");
}

export function providerSessionId(provider: ProviderId, externalId: string) {
  return `${provider}:${externalId}`;
}

export function latestIso(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) || null;
}

export function firstIso(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(0) || null;
}


