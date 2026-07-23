import fs from "node:fs/promises";
import type { ImportDiagnostic, ParsedEvent, ParsedSession, SourceAdapter } from "@/lib/types";
import { event, providerSessionId, roleKind, shortHash, textFromContent } from "./utils";

type Json = Record<string, unknown>;

function isChatGptExport(value: unknown): value is Json[] {
  return Array.isArray(value) && value.some((item) => item && typeof item === "object" && "mapping" in item);
}

function isClaudeExport(value: unknown): value is Json[] {
  return Array.isArray(value) && value.some((item) => item && typeof item === "object" && ("chat_messages" in item || "uuid" in item && "name" in item));
}

function chatGptSession(conversation: Json, sourcePath: string): ParsedSession {
  const externalId = String(conversation.id || conversation.conversation_id || shortHash(conversation));
  const mapping = (conversation.mapping || {}) as Record<string, Json>;
  const nodes = Object.entries(mapping).map(([nodeId, node]) => ({ nodeId, node })).sort((a, b) => {
    const am = (a.node.message || {}) as Json; const bm = (b.node.message || {}) as Json;
    return Number(am.create_time || Number.MAX_SAFE_INTEGER) - Number(bm.create_time || Number.MAX_SAFE_INTEGER);
  });
  const events: ParsedEvent[] = nodes.map(({ nodeId, node }, sequence) => {
    if (!node.message) return event({ sequence, timestamp: null, kind: "unknown", text: "Unsupported export node", input: node, raw: node, externalId: nodeId });
    const message = node.message as Json;
    const author = (message.author || {}) as Json;
    const role = String(author.role || "unknown");
    const content = (message.content || {}) as Json;
    const text = textFromContent(content.parts || content.text || content);
    const timestamp = message.create_time ? new Date(Number(message.create_time) * 1000).toISOString() : null;
    const kind = role === "tool" ? "tool_result" : roleKind(role);
    return event({ sequence, timestamp, kind, role, toolName: role === "tool" ? String(author.name || "tool") : null, text, output: role === "tool" ? content : null, raw: node, externalId: String(message.id || nodeId), canonicalKey: `${role}:${shortHash(text)}` });
  });
  return {
    id: providerSessionId("chatgpt", externalId), provider: "chatgpt", externalId,
    title: String(conversation.title || events.find((item) => item.kind === "user_message")?.text || "Untitled ChatGPT conversation").slice(0, 100),
    projectPath: null, sourcePath, startedAt: events.at(0)?.timestamp || null, updatedAt: events.at(-1)?.timestamp || null,
    model: null, available: true, metadata: { currentNode: conversation.current_node }, events,
  };
}

function claudeSession(conversation: Json, sourcePath: string): ParsedSession {
  const externalId = String(conversation.uuid || conversation.id || shortHash(conversation));
  const messages = (conversation.chat_messages || conversation.messages || []) as Json[];
  const events = messages.map((message, sequence) => {
    const role = String(message.sender || message.role || "unknown");
    const normalizedRole = role === "human" ? "user" : role;
    const text = textFromContent(message.content || message.text);
    return event({
      sequence, timestamp: String(message.created_at || message.createdAt || "") || null,
      kind: roleKind(normalizedRole), role: normalizedRole, text, raw: message,
      externalId: String(message.uuid || message.id || sequence), canonicalKey: `${normalizedRole}:${shortHash(text)}`,
    });
  });
  return {
    id: providerSessionId("claude-desktop", externalId), provider: "claude-desktop", externalId,
    title: String(conversation.name || conversation.title || events.find((item) => item.kind === "user_message")?.text || "Untitled Claude conversation").slice(0, 100),
    projectPath: null, sourcePath, startedAt: String(conversation.created_at || "") || events.at(0)?.timestamp || null,
    updatedAt: String(conversation.updated_at || "") || events.at(-1)?.timestamp || null,
    model: null, available: true, metadata: conversation.summary, events,
  };
}

export const exportAdapter: SourceAdapter = {
  id: "chatgpt",
  label: "Conversation export",
  async detect(filePath) {
    if (!filePath.endsWith(".json")) return false;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      return isChatGptExport(parsed) || isClaudeExport(parsed);
    } catch { return false; }
  },
  async *parse(filePath): AsyncGenerator<ParsedSession | ImportDiagnostic> {
    let parsed: unknown;
    try { parsed = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (error) {
      yield { sourcePath: filePath, severity: "error", message: error instanceof Error ? error.message : "Invalid export JSON" };
      return;
    }
    if (isChatGptExport(parsed)) {
      for (const conversation of parsed) yield chatGptSession(conversation, filePath);
      return;
    }
    if (isClaudeExport(parsed)) {
      for (const conversation of parsed) yield claudeSession(conversation, filePath);
      return;
    }
    yield { sourcePath: filePath, severity: "error", message: "This JSON file is not a recognized ChatGPT or Claude export." };
  },
};


