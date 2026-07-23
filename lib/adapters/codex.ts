import fs from "node:fs/promises";
import type { ImportDiagnostic, ParsedEvent, ParsedSession, SourceAdapter } from "@/lib/types";
import { event, filenameId, firstIso, jsonLines, latestIso, providerSessionId, roleKind, safeJson, shortHash, textFromContent } from "./utils";

type Json = Record<string, unknown>;

function codexEvent(row: Json, sequence: number): ParsedEvent {
  const outer = String(row.type || "unknown");
  const payload = (row.payload || {}) as Json;
  const type = String(payload.type || outer);
  const timestamp = typeof row.timestamp === "string" ? row.timestamp : null;
  const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
  const callId = String(payload.call_id || payload.id || "") || null;

  if (outer === "response_item") {
    if (type === "message" || type === "agent_message") {
      const role = String(payload.role || "assistant");
      const text = textFromContent(payload.content);
      return event({ sequence, timestamp, kind: roleKind(role), role, turnId, callId, text, raw: row, externalId: String(payload.id || sequence), canonicalKey: `${turnId}:${role}:${shortHash(text)}` });
    }
    if (type === "reasoning") {
      return event({ sequence, timestamp, kind: "reasoning", role: "assistant", turnId, text: textFromContent(payload.summary), input: payload.encrypted_content ? { encrypted: true } : null, raw: row, externalId: String(payload.id || sequence) });
    }
    if (["function_call", "custom_tool_call", "web_search_call", "image_generation_call", "tool_search_call"].includes(type)) {
      const name = String(payload.name || type.replace(/_call$/, ""));
      return event({ sequence, timestamp, kind: "tool_call", role: "assistant", turnId, callId, toolName: name, text: name, input: safeJson(payload.arguments ?? payload.input ?? payload.action), status: payload.status as string | null, raw: row, externalId: callId || String(sequence) });
    }
    if (["function_call_output", "custom_tool_call_output", "tool_search_output"].includes(type)) {
      return event({ sequence, timestamp, kind: "tool_result", role: "tool", turnId, callId, toolName: null, text: textFromContent(payload.output), output: safeJson(payload.output), status: payload.status as string | null, raw: row, externalId: callId || String(sequence) });
    }
  }

  if (outer === "event_msg") {
    if (type === "user_message") {
      const text = String(payload.message || "");
      return event({ sequence, timestamp, kind: "user_message", role: "user", turnId, text, raw: row, externalId: String(payload.client_id || sequence), canonicalKey: `${turnId}:user:${shortHash(text)}` });
    }
    if (type === "agent_message") {
      const text = String(payload.message || "");
      return event({ sequence, timestamp, kind: "assistant_message", role: "assistant", turnId, text, raw: row, externalId: String(sequence), canonicalKey: `${turnId}:assistant:${shortHash(text)}` });
    }
    if (type === "agent_reasoning") return event({ sequence, timestamp, kind: "reasoning", role: "assistant", turnId, text: String(payload.text || ""), raw: row, externalId: String(sequence) });
    if (type === "token_count") {
      const info = (payload.info || {}) as Json;
      const total = (info.total_token_usage || info.last_token_usage || {}) as Json;
      return event({ sequence, timestamp, kind: "usage", turnId, text: "Token usage", inputTokens: Number(total.input_tokens || 0) || null, outputTokens: Number(total.output_tokens || 0) || null, totalTokens: Number(total.total_tokens || 0) || null, input: payload.rate_limits, raw: row, externalId: String(sequence) });
    }
    if (type === "error" || type === "turn_aborted") return event({ sequence, timestamp, kind: "error", turnId, text: String(payload.message || payload.reason || type), status: "error", raw: row, externalId: String(sequence) });
    if (type.endsWith("_end")) return event({ sequence, timestamp, kind: type.includes("exec_command") || type.includes("tool") ? "tool_result" : "metadata", turnId, callId, toolName: String(payload.name || type.replace(/_end$/, "")), text: String(payload.message || type), output: payload, status: String(payload.status || "completed"), durationMs: Number(payload.duration_ms || 0) || null, raw: row, externalId: String(sequence) });
  }

  const kind = outer === "turn_context" || outer === "world_state" ? "system" : "metadata";
  return event({ sequence, timestamp, kind, turnId, text: type, input: kind === "system" ? null : payload, raw: row, externalId: String(payload.id || sequence) });
}

export const codexAdapter: SourceAdapter = {
  id: "codex",
  label: "Codex",
  async detect(filePath) {
    if (!filePath.endsWith(".jsonl")) return false;
    try {
      const handle = await fs.open(filePath, "r");
      const buffer = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      await handle.close();
      const row = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0]) as Json;
      return ["session_meta", "event_msg", "response_item", "turn_context", "world_state"].includes(String(row.type));
    } catch { return false; }
  },
  async *parse(filePath): AsyncGenerator<ParsedSession | ImportDiagnostic> {
    const events: ParsedEvent[] = [];
    const timestamps: string[] = [];
    let externalId = filenameId(filePath).split("-").at(-1) || filenameId(filePath);
    let title = "Untitled Codex session";
    let projectPath: string | null = null;
    let model: string | null = null;
    let sequence = 0;
    for await (const parsed of jsonLines(filePath)) {
      if (parsed.error || !parsed.value) {
        yield { provider: "codex", sourcePath: filePath, severity: "warning", message: parsed.error || "Malformed JSON line", line: parsed.line };
        continue;
      }
      const row = parsed.value;
      if (typeof row.timestamp === "string") timestamps.push(row.timestamp);
      const payload = (row.payload || {}) as Json;
      if (row.type === "session_meta") {
        externalId = String(payload.id || payload.session_id || externalId);
        projectPath = typeof payload.cwd === "string" ? payload.cwd : projectPath;
        model = typeof payload.model === "string" ? payload.model : model;
      }
      if (row.type === "turn_context") {
        projectPath = typeof payload.cwd === "string" ? payload.cwd : projectPath;
        model = typeof payload.model === "string" ? payload.model : model;
      }
      const normalized = codexEvent(row, sequence++);
      events.push(normalized);
      if (normalized.kind === "user_message" && title === "Untitled Codex session" && normalized.text) title = normalized.text.replace(/\s+/g, " ").slice(0, 90);
    }
    yield {
      id: providerSessionId("codex", externalId), provider: "codex", externalId, title,
      projectPath, sourcePath: filePath, startedAt: firstIso(timestamps), updatedAt: latestIso(timestamps),
      model, available: true, events,
    };
  },
};


