import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_CONCEPTS, PROVIDER_DATA_MAP, VISIBLE_DATA_MAP_PROVIDERS } from "@/lib/adapters/data-map";
import { event } from "@/lib/adapters/utils";
import type { ParsedSession, ProviderId } from "@/lib/types";
import { sanitizeSample } from "@/lib/server/sample-preview";

let directory: string | undefined;

async function modules() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-data-map-"));
  process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
  const database = await import("@/lib/server/db");
  database.closeDb();
  return {
    database,
    repository: await import("@/lib/server/repository"),
    dataMap: await import("@/lib/server/data-map"),
  };
}

function parsedSession(provider: ProviderId, events: ParsedSession["events"]): ParsedSession {
  return {
    id: `${provider}:data-map-test`, provider, externalId: "data-map-test", title: "Data map test",
    projectPath: "/example-workspace/data-map", sourcePath: `/example/${provider}.jsonl`,
    startedAt: "2026-08-05T10:00:00Z", updatedAt: "2026-08-05T10:01:00Z",
    model: "example-model", available: true, events,
  };
}

afterEach(async () => {
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("data map catalog", () => {
  it("covers every normalized event kind and documents message mappings for every visible provider", () => {
    const covered = new Set(DATA_CONCEPTS.flatMap((concept) => concept.kinds));
    expect([...covered].sort()).toEqual([
      "assistant_message", "attachment", "error", "metadata", "reasoning", "system", "tool_call",
      "tool_result", "unknown", "usage", "user_message",
    ]);
    for (const provider of VISIBLE_DATA_MAP_PROVIDERS) {
      expect(PROVIDER_DATA_MAP[provider].messages?.nativeRecords.length, provider).toBeGreaterThan(0);
    }
    expect(PROVIDER_DATA_MAP.codex["usage-tokens"]?.fields.map((item) => item.field)).toContain("totalTokens");
    expect(PROVIDER_DATA_MAP.cursor["usage-tokens"]).toBeUndefined();
    expect(PROVIDER_DATA_MAP.chatgpt["tool-calls"]).toBeUndefined();
  });
});

describe("sample preview sanitizer", () => {
  it("redacts secrets, encrypted content, emails, home folders, bearer values, and oversized structures", () => {
    const privatePath = ["", "Users", "example", "private", "project.ts"].join("/");
    const value = {
      api_key: "secret-value",
      encrypted_content: "opaque-value",
      contact: "person@example.com",
      path: privatePath,
      authorization: "Bearer very-secret-token",
      nested: Array.from({ length: 20 }, (_, index) => ({ index, text: "x".repeat(400) })),
    };
    const preview = sanitizeSample(value);
    const text = JSON.stringify(preview.sample);
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("opaque-value");
    expect(text).not.toContain("person@example.com");
    expect(text).not.toContain(privatePath);
    expect(text).not.toContain("very-secret-token");
    expect(text).toContain("[redacted]");
    expect(preview.truncated).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4_096);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("data map repository", () => {
  it("aggregates concepts and fields, returns sanitized samples, and replaces stats transactionally", async () => {
    const { repository, dataMap } = await modules();
    const privatePath = ["", "Users", "example", "private.ts"].join("/");
    await repository.saveParsedSession(parsedSession("codex", [
      event({ sequence: 0, kind: "user_message", timestamp: "2026-08-05T10:00:00Z", role: "user", text: "Inspect it", raw: { type: "event_msg", payload: { message: "Inspect it" } } }),
      event({ sequence: 1, kind: "assistant_message", timestamp: "2026-08-05T10:00:01Z", role: "assistant", text: "I will inspect it", raw: { type: "response_item", payload: { content: "I will inspect it" } } }),
      event({ sequence: 2, kind: "tool_call", timestamp: "2026-08-05T10:00:02Z", role: "assistant", callId: "call-1", toolName: "read_file", input: { api_key: "never-return", path: privatePath }, raw: { type: "response_item", payload: { type: "function_call", call_id: "call-1", name: "read_file", arguments: { api_key: "never-return", path: privatePath, email: "person@example.com" } } } }),
      event({ sequence: 3, kind: "usage", timestamp: "2026-08-05T10:00:03Z", inputTokens: 10, outputTokens: 4, totalTokens: 14, raw: { type: "event_msg", payload: { type: "token_count" } } }),
    ]));

    const summary = dataMap.getDataMap();
    const messages = summary.concepts.find((item) => item.id === "messages")!;
    const codexMessages = messages.providers.find((item) => item.provider === "codex")!;
    expect(messages.eventCount).toBe(2);
    expect(codexMessages.fieldCoverage.text).toBe(100);
    expect(codexMessages.sampleCount).toBe(2);
    const toolCalls = summary.concepts.find((item) => item.id === "tool-calls")!;
    expect(toolCalls.providers.find((item) => item.provider === "codex")).toMatchObject({ eventCount: 1, status: "recorded" });
    expect(toolCalls.providers.find((item) => item.provider === "chatgpt")?.status).toBe("unsupported");

    const sample = dataMap.getDataMapSample("codex", "tool-calls", 0)!;
    const serialized = JSON.stringify(sample);
    expect(serialized).not.toContain("never-return");
    expect(serialized).not.toContain(privatePath);
    expect(serialized).not.toContain("person@example.com");
    expect(sample.total).toBe(1);

    await repository.saveParsedSession(parsedSession("codex", [
      event({ sequence: 0, kind: "assistant_message", role: "assistant", text: "Replacement", raw: { replacement: true } }),
    ]));
    const replaced = dataMap.getDataMap();
    expect(replaced.concepts.find((item) => item.id === "tool-calls")?.eventCount).toBe(0);
    expect(replaced.concepts.find((item) => item.id === "messages")?.eventCount).toBe(1);
  });

  it("backfills missing summaries once and clears them with the local index", async () => {
    const { database, repository, dataMap } = await modules();
    await repository.saveParsedSession(parsedSession("cursor", [
      event({ sequence: 0, kind: "reasoning", role: "assistant", text: "Think", raw: { thinking: "Think" } }),
    ]));
    database.getDb().prepare("DELETE FROM session_event_stats").run();
    expect((database.getDb().prepare("SELECT COUNT(*) count FROM session_event_stats").get() as { count: number }).count).toBe(0);
    dataMap.ensureDataMapStats();
    expect((database.getDb().prepare("SELECT COUNT(*) count FROM session_event_stats").get() as { count: number }).count).toBe(1);
    database.resetDb();
    expect((database.getDb().prepare("SELECT COUNT(*) count FROM session_event_stats").get() as { count: number }).count).toBe(0);
  });
});
