import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectAdapter } from "@/lib/adapters";
import type { ImportDiagnostic } from "@/lib/types";
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

async function parseExample(name: string) {
  const file = path.join(process.cwd(), "examples", "provider-native", name);
  const adapter = await detectAdapter(file);
  if (!adapter) throw new Error(`No adapter detected for ${name}`);
  const sessions: ParsedSession[] = [];
  for await (const value of adapter.parse(file)) {
    if ("events" in value) sessions.push(value);
    else {
      const diagnostic = value as ImportDiagnostic;
      throw new Error(`${name}: ${diagnostic.message}`);
    }
  }
  return sessions;
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

  it("indexes, searches, filters, and idempotently re-imports every example provider", async () => {
    const { repository: repo } = await repository();
    const names = [
      "codex-example.jsonl",
      "claude-code-example.jsonl",
      "claude-desktop-example-audit.jsonl",
      "cursor-example.vscdb",
    ];

    for (const name of names) {
      const [example] = await parseExample(name);
      await repo.saveParsedSession(example);
    }

    const firstOverview = repo.overview();
    expect(firstOverview.totalSessions).toBe(4);
    for (const provider of ["codex", "claude-code", "claude-desktop", "cursor"]) {
      expect(firstOverview.providers.find((item) => item.id === provider)?.sessionCount).toBe(1);
    }
    expect(repo.searchEvents("Example").length).toBeGreaterThanOrEqual(4);
    const toolEvents = repo.listEvents("codex:example-codex-lantern-notes", ["tool_call"]);
    expect(toolEvents.length).toBeGreaterThan(0);
    expect(repo.getEvent(toolEvents[0].id)?.raw).toMatchObject({ payload: { synthetic: true } });

    for (const name of names) {
      const [example] = await parseExample(name);
      await repo.saveParsedSession(example);
    }

    expect(repo.overview().totalSessions).toBe(4);
  });
});
