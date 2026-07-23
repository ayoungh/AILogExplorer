import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeJsonlAdapter } from "@/lib/adapters/claude";
import { codexAdapter } from "@/lib/adapters/codex";
import { cursorAdapter } from "@/lib/adapters/cursor";
import { exportAdapter } from "@/lib/adapters/exports";
import { detectAdapter } from "@/lib/adapters";
import type { ImportDiagnostic, ParsedSession } from "@/lib/types";

const tempDirectories: string[] = [];

async function tempFile(name: string, content: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-test-"));
  tempDirectories.push(directory);
  const file = path.join(directory, name);
  await fs.writeFile(file, content);
  return file;
}

async function parsed(adapter: { parse(path: string): AsyncGenerator<ParsedSession | ImportDiagnostic> }, file: string) {
  const values: Array<ParsedSession | ImportDiagnostic> = [];
  for await (const value of adapter.parse(file)) values.push(value);
  return values.filter((value): value is ParsedSession => "events" in value);
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Claude adapter", () => {
  it("normalizes text, thinking, tool calls, results, and malformed lines", async () => {
    const rows = [
      { type: "user", sessionId: "claude-1", timestamp: "2026-01-01T10:00:00Z", cwd: "/tmp/project", message: { role: "user", content: "Build it" }, uuid: "u1" },
      { type: "assistant", sessionId: "claude-1", timestamp: "2026-01-01T10:00:01Z", message: { role: "assistant", model: "claude-test", content: [
        { type: "thinking", thinking: "Inspect first" },
        { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "app.ts" } },
        { type: "text", text: "Done" },
      ] }, uuid: "a1" },
      { type: "assistant", sessionId: "claude-1", timestamp: "2026-01-01T10:00:01Z", message: { role: "assistant", content: { type: "text", text: "Object text" } }, uuid: "a2" },
      { type: "user", sessionId: "claude-1", timestamp: "2026-01-01T10:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "source", is_error: false }] }, uuid: "r1" },
    ];
    const file = await tempFile("claude.jsonl", `${rows.map((row) => JSON.stringify(row)).join("\n")}\n{broken\n`);
    const sessions = await parsed(new ClaudeJsonlAdapter(), file);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].externalId).toBe("claude-1");
    expect(sessions[0].events.map((item) => item.kind)).toEqual(["user_message", "reasoning", "tool_call", "assistant_message", "assistant_message", "tool_result"]);
    expect(sessions[0].events.find((item) => item.text === "Object text")?.kind).toBe("assistant_message");
    expect(sessions[0].events.find((item) => item.kind === "tool_call")?.toolName).toBe("Read");
  });

  it("distinguishes ordinary Claude Code rows from audited Claude Desktop rows", async () => {
    const codeFile = await tempFile("code.jsonl", JSON.stringify({
      type: "user",
      sessionId: "code-session",
      message: { role: "user", content: "Synthetic code prompt" },
    }));
    const desktopFile = await tempFile("audit.jsonl", JSON.stringify({
      type: "user",
      session_id: "desktop-session",
      _audit_timestamp: "2026-01-01T00:00:00Z",
      _audit_hmac: "example-audit-hmac",
      message: { role: "user", content: "Synthetic desktop prompt" },
    }));

    expect((await detectAdapter(codeFile))?.id).toBe("claude-code");
    expect((await detectAdapter(desktopFile))?.id).toBe("claude-desktop");
  });
});

describe("Codex adapter", () => {
  it("normalizes mirrored messages, tool calls, outputs, usage, and system context", async () => {
    const rows = [
      { type: "session_meta", timestamp: "2026-01-02T09:00:00Z", payload: { id: "codex-1", cwd: "/tmp/app" } },
      { type: "event_msg", timestamp: "2026-01-02T09:00:01Z", payload: { type: "user_message", turn_id: "t1", message: "Find routes" } },
      { type: "response_item", timestamp: "2026-01-02T09:00:02Z", payload: { type: "function_call", call_id: "c1", name: "exec_command", arguments: "{\"cmd\":\"rg route\"}" } },
      { type: "response_item", timestamp: "2026-01-02T09:00:03Z", payload: { type: "function_call_output", call_id: "c1", output: "app/route.ts" } },
      { type: "event_msg", timestamp: "2026-01-02T09:00:04Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } } },
      { type: "world_state", timestamp: "2026-01-02T09:00:05Z", payload: { full: true, state: { safe: true } } },
    ];
    const file = await tempFile("rollout-codex-1.jsonl", rows.map((row) => JSON.stringify(row)).join("\n"));
    const [session] = await parsed(codexAdapter, file);
    expect(session.externalId).toBe("codex-1");
    expect(session.events.some((item) => item.kind === "tool_call" && item.toolName === "exec_command")).toBe(true);
    expect(session.events.some((item) => item.kind === "tool_result" && item.callId === "c1")).toBe(true);
    expect(session.events.find((item) => item.kind === "usage")?.totalTokens).toBe(14);
    expect(session.events.some((item) => item.kind === "system")).toBe(true);
  });
});

describe("Cursor adapter", () => {
  it("combines composer and bubble records from read-only SQLite", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-test-"));
    tempDirectories.push(directory);
    const file = path.join(directory, "state.vscdb");
    const db = new Database(file);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB)");
    db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("composerData:session-1", JSON.stringify({ composerId: "session-1", name: "Cursor task", createdAt: 1000, lastUpdatedAt: 2000, modelConfig: { modelName: "cursor-test" } }));
    db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("bubbleId:session-1:b1", JSON.stringify({ bubbleId: "b1", type: 1, text: "Fix this", createdAt: 1000 }));
    db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("bubbleId:session-1:b2", JSON.stringify({ bubbleId: "b2", type: 2, text: "I will inspect it", thinking: "Check files", toolFormerData: { name: "read_file" }, toolResults: [{ ok: true }], createdAt: 2000 }));
    db.close();
    const [session] = await parsed(cursorAdapter, file);
    expect(session.title).toBe("Cursor task");
    expect(session.events.map((item) => item.kind)).toContain("reasoning");
    expect(session.events.map((item) => item.kind)).toContain("tool_call");
    expect(session.events.map((item) => item.kind)).toContain("tool_result");
  });

  it("accepts ISO timestamps and ignores deleted composer tombstones", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-test-"));
    tempDirectories.push(directory);
    const file = path.join(directory, "state.vscdb");
    const db = new Database(file);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB)");
    db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("composerData:deleted", null);
    db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("composerData:iso", JSON.stringify({
      composerId: "iso",
      name: "ISO session",
      createdAt: "2026-07-22T12:00:00.000Z",
      lastUpdatedAt: "not-a-date",
    }));
    db.close();

    const sessions = await parsed(cursorAdapter, file);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].startedAt).toBe("2026-07-22T12:00:00.000Z");
  });
});

describe("conversation export adapter", () => {
  it("detects and flattens a ChatGPT mapping export", async () => {
    const exportValue = [{ id: "chat-1", title: "Exported chat", mapping: {
      one: { message: { id: "m1", create_time: 1, author: { role: "user" }, content: { parts: ["Hello"] } } },
      two: { message: { id: "m2", create_time: 2, author: { role: "assistant" }, content: { parts: ["Hi"] } } },
      unsupported: { parent: "two", children: [] },
    } }];
    const file = await tempFile("conversations.json", JSON.stringify(exportValue));
    expect(await exportAdapter.detect(file)).toBe(true);
    const [session] = await parsed(exportAdapter, file);
    expect(session.provider).toBe("chatgpt");
    expect(session.events.map((item) => item.kind)).toEqual(["user_message", "assistant_message", "unknown"]);
  });
});

describe("provider-native example fixtures", () => {
  const examples = [
    {
      name: "codex-example.jsonl",
      provider: "codex",
      title: "[Example] Add an offline retry queue to Lantern Notes and cover it with tests.",
      kinds: ["user_message", "reasoning", "tool_call", "tool_result", "assistant_message", "usage"],
    },
    {
      name: "claude-code-example.jsonl",
      provider: "claude-code",
      title: "[Example] Fix local-day calendar grouping",
      kinds: ["user_message", "reasoning", "tool_call", "tool_result", "assistant_message"],
    },
    {
      name: "claude-desktop-example-audit.jsonl",
      provider: "claude-desktop",
      title: "[Example] Draft a launch brief",
      kinds: ["user_message", "system", "attachment", "reasoning", "tool_call", "tool_result", "assistant_message"],
    },
    {
      name: "cursor-example.vscdb",
      provider: "cursor",
      title: "[Example] Repair keyboard search selection",
      kinds: ["user_message", "assistant_message", "reasoning", "tool_call", "tool_result"],
    },
  ] as const;

  for (const example of examples) {
    it(`detects and parses ${example.name}`, async () => {
      const file = path.join(process.cwd(), "examples", "provider-native", example.name);
      const adapter = await detectAdapter(file);
      expect(adapter?.id).toBe(example.provider);
      const sessions = await parsed(adapter!, file);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].provider).toBe(example.provider);
      expect(sessions[0].title).toBe(example.title);
      expect(sessions[0].projectPath).toMatch(/^\/example-workspace\//);
      const actualKinds = sessions[0].events.map((item) => item.kind);
      for (const kind of example.kinds) expect(actualKinds).toContain(kind);
      expect(sessions[0].events.some((item) => JSON.stringify(item.raw).includes("\"synthetic\":true"))).toBe(true);
    });
  }

  it("preserves paired tool call identifiers in the generated JSONL fixtures", async () => {
    for (const name of ["codex-example.jsonl", "claude-code-example.jsonl", "claude-desktop-example-audit.jsonl"]) {
      const file = path.join(process.cwd(), "examples", "provider-native", name);
      const adapter = await detectAdapter(file);
      const [session] = await parsed(adapter!, file);
      const calls = new Set(session.events.filter((item) => item.kind === "tool_call").map((item) => item.callId));
      const results = session.events.filter((item) => item.kind === "tool_result").map((item) => item.callId);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((callId) => callId !== null && calls.has(callId))).toBe(true);
    }
  });
});
