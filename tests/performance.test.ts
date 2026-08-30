import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { event } from "@/lib/adapters/utils";
import type { ParsedSession } from "@/lib/types";

let directory: string | undefined;

afterEach(async () => {
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("large-index performance", () => {
  it("keeps repeated 100k-event search below 200ms and warm analytics below 500ms", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-performance-"));
    process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
    const database = await import("@/lib/server/db");
    database.closeDb();
    const repository = await import("@/lib/server/repository");
    const startedAt = Date.parse("2026-01-01T00:00:00.000Z");
    const events = Array.from({ length: 100_000 }, (_, sequence) => event({
      sequence,
      timestamp: new Date(startedAt + sequence * 1_000).toISOString(),
      kind: sequence % 10 === 0 ? "tool_call" : "assistant_message",
      toolName: sequence % 10 === 0 ? "benchmark_tool" : null,
      text: `synthetic benchmark event needle${sequence}`,
      raw: { synthetic: true, sequence },
    }));
    const session: ParsedSession = {
      id: "performance-session",
      provider: "codex",
      externalId: "performance-session",
      title: "Synthetic 100k benchmark",
      projectPath: "/synthetic/performance",
      sourcePath: "/synthetic/performance.jsonl",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      model: "synthetic-model",
      available: true,
      events,
    };
    await repository.saveParsedSession(session);

    const search = () => repository.searchEvents({ query: "benchmark", limit: 20, sort: "relevance" });
    search();
    const searchStarted = performance.now();
    const results = search();
    const searchMs = performance.now() - searchStarted;
    expect(results.total).toBe(100_000);
    expect(searchMs).toBeLessThan(200);

    const analytics = () => repository.analytics({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-04T00:00:00.000Z", timezone: "Europe/London" });
    analytics();
    const analyticsStarted = performance.now();
    const report = analytics();
    const analyticsMs = performance.now() - analyticsStarted;
    expect(report.totals.eventCount).toBe(100_000);
    expect(analyticsMs).toBeLessThan(500);
  }, 120_000);
});
