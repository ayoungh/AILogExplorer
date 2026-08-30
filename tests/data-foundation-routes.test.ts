import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { event } from "@/lib/adapters/utils";

let directory: string | undefined;

async function prepare() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-foundation-routes-"));
  process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
  const database = await import("@/lib/server/db");
  database.closeDb();
  const repository = await import("@/lib/server/repository");
  await repository.saveParsedSession({
    id: "codex:foundation-route",
    provider: "codex",
    externalId: "foundation-route",
    title: "Foundation route",
    projectPath: "/example/project",
    sourcePath: "/example/source.jsonl",
    startedAt: "2026-01-03T10:00:00Z",
    updatedAt: "2026-01-03T10:05:00Z",
    model: "example-model",
    available: true,
    events: [
      event({ sequence: 0, timestamp: "2026-01-03T10:00:00Z", kind: "user_message", text: "faceted lantern", raw: {} }),
      event({ sequence: 1, timestamp: "2026-01-03T10:00:01Z", kind: "tool_call", toolName: "read_file", input: { path: "src/app.ts" }, raw: {} }),
      event({ sequence: 2, timestamp: "2026-01-03T10:00:02Z", kind: "usage", inputTokens: 8, outputTokens: 2, totalTokens: 10, raw: {} }),
    ],
  });
}

afterEach(async () => {
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("data foundation routes", () => {
  it("returns faceted search and validates dates", async () => {
    await prepare();
    const route = await import("@/app/api/search/route");
    const response = await route.GET(new NextRequest("http://localhost/api/search?q=lantern&provider=codex&kind=user_message"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 1, nextOffset: null });
    expect(body.data[0]).toMatchObject({ provider: "codex", sessionTitle: "Foundation route", model: "example-model" });
    expect(body.facets.providers[0]).toMatchObject({ value: "codex", count: 1 });
    expect((await route.GET(new NextRequest("http://localhost/api/search?q=lantern&from=nope"))).status).toBe(400);
    expect((await route.GET(new NextRequest("http://localhost/api/search?q=%22%22"))).status).toBe(200);
  });

  it("returns session metrics, analytics, and observed-file deep-link data", async () => {
    await prepare();
    const metricsRoute = await import("@/app/api/sessions/[id]/metrics/route");
    const metricsResponse = await metricsRoute.GET(new Request("http://localhost/api/sessions/codex:foundation-route/metrics"), { params: Promise.resolve({ id: "codex:foundation-route" }) });
    expect(await metricsResponse.json()).toMatchObject({ sessionId: "codex:foundation-route", messageCount: 1, toolCallCount: 1, totalTokens: 10, tokenRecorded: true });

    const analyticsRoute = await import("@/app/api/analytics/route");
    const analyticsResponse = await analyticsRoute.GET(new NextRequest("http://localhost/api/analytics?from=2026-01-03T00:00:00Z&to=2026-01-04T00:00:00Z&timezone=Europe%2FLondon"));
    expect(await analyticsResponse.json()).toMatchObject({ totals: { sessionCount: 1, eventCount: 3, totalTokens: 10 }, activity: [{ bucketStart: "2026-01-03", eventCount: 3 }] });
    expect((await analyticsRoute.GET(new NextRequest("http://localhost/api/analytics?timezone=Not%2FAZone"))).status).toBe(400);

    const filesRoute = await import("@/app/api/recent-files/route");
    const filesResponse = await filesRoute.GET(new NextRequest("http://localhost/api/recent-files?action=read"));
    const files = await filesResponse.json();
    expect(files.data[0]).toMatchObject({ path: "/example/project/src/app.ts", projectPath: "/example/project" });
    expect(files.data[0].references[0]).toMatchObject({ sessionId: "codex:foundation-route", provider: "codex", action: "read" });
  });
});
