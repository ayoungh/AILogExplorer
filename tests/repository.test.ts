import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ParsedSession } from "@/lib/types";

let directory: string | undefined;

async function repository() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-repository-"));
  process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
  const database = await import("@/lib/server/db");
  database.closeDb();
  const repository = await import("@/lib/server/repository");
  return { database, repository };
}

function session(events: ParsedSession["events"]): ParsedSession {
  return {
    id: "session-1",
    provider: "codex",
    externalId: "external-1",
    title: "Repository test",
    projectPath: "/tmp/project",
    sourcePath: "/tmp/source.jsonl",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:01Z",
    model: "test",
    available: true,
    events,
  };
}

afterEach(async () => {
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("repository indexing", () => {
  it("collapses canonical duplicates while preserving their raw records", async () => {
    const { repository: repo } = await repository();
    await repo.saveParsedSession(session([
      { sequence: 0, timestamp: null, kind: "user_message", role: "user", turnId: "t1", callId: null, parentId: null, toolName: null, text: "same prompt", input: null, output: null, status: null, durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null, externalId: "same", canonicalKey: "prompt", raw: { copy: 1 } },
      { sequence: 1, timestamp: null, kind: "user_message", role: "user", turnId: "t1", callId: null, parentId: null, toolName: null, text: "same prompt", input: null, output: null, status: null, durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null, externalId: "same", canonicalKey: "prompt", raw: { copy: 2 } },
    ]));
    const events = repo.listEvents("session-1");
    expect(events).toHaveLength(1);
    const detailed = repo.getEvent(events[0].id);
    expect(detailed?.rawRecordCount).toBe(2);
    expect(detailed?.raw).toEqual({ canonical: { copy: 1 }, duplicateRecords: [{ copy: 2 }] });
  });

  it("disambiguates reused external IDs, compresses large normalized output, and replaces sessions transactionally", async () => {
    const { database, repository: repo } = await repository();
    const large = { text: "compress me ".repeat(2_000) };
    await repo.saveParsedSession(session([
      { sequence: 0, timestamp: null, kind: "tool_result", role: "tool", turnId: "t1", callId: "call", parentId: null, toolName: null, text: "first", input: null, output: large, status: "success", durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null, externalId: "reused", raw: large },
      { sequence: 1, timestamp: null, kind: "metadata", role: null, turnId: null, callId: null, parentId: null, toolName: null, text: "second", input: null, output: null, status: null, durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null, externalId: "reused", raw: { second: true } },
    ]));
    expect(repo.listEvents("session-1")).toHaveLength(2);
    const row = database.getDb().prepare("SELECT typeof(output_json) type FROM events WHERE kind='tool_result'").get() as { type: string };
    expect(row.type).toBe("blob");
    expect(repo.listEvents("session-1")[0].output).toEqual(large);
    expect(repo.searchEvents("first")).toHaveLength(1);

    await repo.saveParsedSession(session([
      { sequence: 0, timestamp: null, kind: "assistant_message", role: "assistant", turnId: "t2", callId: null, parentId: null, toolName: null, text: "replacement", input: null, output: null, status: null, durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null, externalId: "replacement", raw: { replacement: true } },
    ]));
    expect(repo.listEvents("session-1").map((event) => event.text)).toEqual(["replacement"]);
  });
});
