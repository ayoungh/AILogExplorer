import fs from "node:fs/promises";
import type { ImportDiagnostic, ParsedEvent, ParsedSession, ProviderId, SourceAdapter } from "@/lib/types";
import { event, filenameId, firstIso, jsonLines, latestIso, providerSessionId, shortHash, textFromContent } from "./utils";

type Json = Record<string, unknown>;

function contentEvents(row: Json, role: string, sequence: number): ParsedEvent[] {
  const message = (row.message || {}) as Json;
  const content = message.content;
  const base = {
    timestamp: typeof row.timestamp === "string" ? row.timestamp : typeof row._audit_timestamp === "string" ? row._audit_timestamp : null,
    role,
    turnId: typeof row.promptId === "string" ? row.promptId : null,
    parentId: typeof row.parentUuid === "string" ? row.parentUuid : null,
    raw: row,
  };
  if (!Array.isArray(content)) {
    const text = textFromContent(content);
    return [event({ ...base, sequence, kind: role === "user" ? "user_message" : "assistant_message", text, externalId: String(row.uuid || sequence), canonicalKey: `${role}:${shortHash(text)}` })];
  }
  return content.map((part, index) => {
    const block = (part || {}) as Json;
    const blockType = String(block.type || "unknown");
    const externalId = String(block.id || block.tool_use_id || `${row.uuid || sequence}:${index}`);
    if (blockType === "thinking") return event({ ...base, sequence: sequence + index / 100, kind: "reasoning", text: String(block.thinking || ""), externalId });
    if (blockType === "tool_use") return event({ ...base, sequence: sequence + index / 100, kind: "tool_call", toolName: String(block.name || "tool"), callId: String(block.id || ""), input: block.input, text: String(block.name || "Tool call"), externalId });
    if (blockType === "tool_result") return event({ ...base, sequence: sequence + index / 100, kind: "tool_result", callId: String(block.tool_use_id || ""), output: block.content, status: block.is_error ? "error" : "success", text: textFromContent(block.content), externalId });
    if (blockType === "image") return event({ ...base, sequence: sequence + index / 100, kind: "attachment", text: "Image attachment", input: block.source, externalId });
    return event({ ...base, sequence: sequence + index / 100, kind: role === "user" ? "user_message" : "assistant_message", text: textFromContent(block), externalId, canonicalKey: `${role}:${shortHash(textFromContent(block))}` });
  });
}

export class ClaudeJsonlAdapter implements SourceAdapter {
  id: ProviderId;
  label: string;

  constructor(desktop = false) {
    this.id = desktop ? "claude-desktop" : "claude-code";
    this.label = desktop ? "Claude Desktop" : "Claude Code";
  }

  async detect(filePath: string) {
    if (!filePath.endsWith(".jsonl")) return false;
    try {
      const handle = await fs.open(filePath, "r");
      const buffer = Buffer.alloc(2048);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      await handle.close();
      const first = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
      const parsed = JSON.parse(first) as Json;
      const supported = ["user", "assistant", "queue-operation", "attachment", "system"].includes(String(parsed.type));
      const audited = "_audit_timestamp" in parsed || "_audit_hmac" in parsed;
      return supported && (this.id === "claude-desktop" ? audited : !audited);
    } catch { return false; }
  }

  async *parse(filePath: string): AsyncGenerator<ParsedSession | ImportDiagnostic> {
    const events: ParsedEvent[] = [];
    const timestamps: string[] = [];
    let externalId = filenameId(filePath);
    let title = "Untitled Claude session";
    let projectPath: string | null = null;
    let model: string | null = null;
    let sequence = 0;
    let malformed = 0;
    for await (const parsed of jsonLines(filePath)) {
      if (parsed.error || !parsed.value) {
        malformed += 1;
        yield { provider: this.id, sourcePath: filePath, severity: "warning", message: parsed.error || "Malformed JSON line", line: parsed.line };
        continue;
      }
      const row = parsed.value;
      const type = String(row.type || "unknown");
      if (typeof row.sessionId === "string" || typeof row.session_id === "string") externalId = String(row.sessionId || row.session_id);
      if (typeof row.timestamp === "string" || typeof row._audit_timestamp === "string") timestamps.push(String(row.timestamp || row._audit_timestamp));
      if (typeof row.cwd === "string") projectPath = row.cwd;
      const message = (row.message || {}) as Json;
      if (typeof message.model === "string") model = message.model;

      if (type === "user" || type === "assistant") {
        events.push(...contentEvents(row, type, sequence));
        if (type === "user" && title === "Untitled Claude session") {
          const candidate = textFromContent(message.content).replace(/\s+/g, " ").trim();
          if (candidate) title = candidate.slice(0, 90);
        }
      } else if (type === "custom-title" || type === "ai-title") {
        title = String(row.customTitle || row.title || title);
        events.push(event({ sequence, timestamp: null, kind: "metadata", role: null, text: title, raw: row, externalId: String(row.uuid || sequence) }));
      } else if (type === "attachment") {
        events.push(event({ sequence, timestamp: row.timestamp as string | null, kind: "attachment", text: "Session attachment", input: row.attachment, raw: row, externalId: String(row.uuid || sequence) }));
      } else if (type === "system") {
        const isError = row.level === "error" || row.subtype === "error";
        events.push(event({ sequence, timestamp: row.timestamp as string | null, kind: isError ? "error" : "system", text: textFromContent(row.content), status: isError ? "error" : null, raw: row, externalId: String(row.uuid || sequence) }));
      } else {
        events.push(event({ sequence, timestamp: row.timestamp as string | null, kind: "metadata", text: type, input: row.content, raw: row, externalId: String(row.uuid || sequence) }));
      }
      sequence += 1;
    }
    if (!events.length && malformed) return;
    yield {
      id: providerSessionId(this.id, externalId), provider: this.id, externalId, title,
      projectPath, sourcePath: filePath, startedAt: firstIso(timestamps), updatedAt: latestIso(timestamps),
      model, available: true, metadata: { malformedLines: malformed }, events,
    };
  }
}

