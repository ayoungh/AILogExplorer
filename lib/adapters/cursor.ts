import Database from "better-sqlite3";
import type { ImportDiagnostic, ParsedEvent, ParsedSession, SourceAdapter } from "@/lib/types";
import { event, providerSessionId, shortHash, textFromContent } from "./utils";

type Json = Record<string, unknown>;
type KvRow = { key: string; value: Buffer | string | null };

function parseValue(value: Buffer | string | null): Json | null {
  if (value === null) return null;
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : value) as Json; } catch { return null; }
}

function isoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d+(?:\.\d+)?$/.test(String(value)) ? Number(value) : null;
  const milliseconds = numeric === null ? value : numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cursorEvents(bubbles: KvRow[]): ParsedEvent[] {
  const result: ParsedEvent[] = [];
  bubbles.map((row) => ({ key: row.key, value: parseValue(row.value) })).filter((row): row is { key: string; value: Json } => Boolean(row.value))
    .sort((a, b) => Number(a.value.createdAt || 0) - Number(b.value.createdAt || 0))
    .forEach(({ key, value }, bubbleIndex) => {
      const timestamp = isoTimestamp(value.createdAt);
      const role = Number(value.type) === 1 ? "user" : "assistant";
      const text = String(value.text || value.richText || "");
      const bubbleId = String(value.bubbleId || key.split(":").at(-1) || bubbleIndex);
      if (text) result.push(event({ sequence: result.length, timestamp, kind: role === "user" ? "user_message" : "assistant_message", role, text, raw: value, externalId: bubbleId, canonicalKey: `${role}:${shortHash(text)}` }));
      if (value.thinking || value.allThinkingBlocks) result.push(event({ sequence: result.length, timestamp, kind: "reasoning", role: "assistant", text: textFromContent(value.thinking || value.allThinkingBlocks), durationMs: Number(value.thinkingDurationMs || 0) || null, raw: value, externalId: `${bubbleId}:thinking` }));
      if (value.toolFormerData) result.push(event({ sequence: result.length, timestamp, kind: "tool_call", role: "assistant", toolName: String((value.toolFormerData as Json)?.name || value.capabilityType || "Cursor tool"), text: String((value.toolFormerData as Json)?.name || "Tool call"), input: value.toolFormerData, raw: value, externalId: `${bubbleId}:tool` }));
      if (value.toolResults || value.capabilitiesRan) result.push(event({ sequence: result.length, timestamp, kind: "tool_result", role: "tool", text: "Tool results", output: value.toolResults || value.capabilitiesRan, status: value.errorDetails ? "error" : "success", raw: value, externalId: `${bubbleId}:result` }));
      if (value.errorDetails) result.push(event({ sequence: result.length, timestamp, kind: "error", text: textFromContent(value.errorDetails), status: "error", raw: value, externalId: `${bubbleId}:error` }));
    });
  return result;
}

export const cursorAdapter: SourceAdapter = {
  id: "cursor",
  label: "Cursor",
  async detect(filePath) {
    if (!/\.(db|sqlite|vscdb)$/i.test(filePath) && !filePath.endsWith("state.vscdb")) return false;
    try {
      const db = new Database(filePath, { readonly: true, fileMustExist: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'").all();
      db.close();
      return tables.length > 0;
    } catch { return false; }
  },
  async *parse(filePath): AsyncGenerator<ParsedSession | ImportDiagnostic> {
    let db: Database.Database;
    try { db = new Database(filePath, { readonly: true, fileMustExist: true }); }
    catch (error) {
      yield { provider: "cursor", sourcePath: filePath, severity: "error", message: error instanceof Error ? error.message : "Unable to open Cursor database" };
      return;
    }
    try {
      const composers = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as KvRow[];
      const bubbleQuery = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?");
      for (const row of composers) {
        const data = parseValue(row.value);
        if (!data) {
          if (row.value === null) continue;
          yield { provider: "cursor", sourcePath: filePath, severity: "warning", message: `Could not parse ${row.key}` };
          continue;
        }
        const externalId = String(data.composerId || row.key.slice("composerData:".length));
        const bubbles = bubbleQuery.all(`bubbleId:${externalId}:%`) as KvRow[];
        const events = cursorEvents(bubbles);
        const createdAt = isoTimestamp(data.createdAt) || events.at(0)?.timestamp || null;
        const updatedAt = isoTimestamp(data.lastUpdatedAt) || events.at(-1)?.timestamp || createdAt;
        const modelConfig = (data.modelConfig || {}) as Json;
        yield {
          id: providerSessionId("cursor", externalId), provider: "cursor", externalId,
          title: String(data.name || data.subtitle || data.text || events.find((item) => item.kind === "user_message")?.text || "Untitled Cursor session").slice(0, 100),
          projectPath: String(data.workspaceIdentifier || data.workspaceProjectDir || "") || null,
          sourcePath: filePath, startedAt: createdAt, updatedAt, model: String(modelConfig.modelName || "") || null,
          available: true, metadata: data, events,
        };
      }
    } finally { db.close(); }
  },
};
