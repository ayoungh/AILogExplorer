import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import type { EventPageResponse, ParsedSession } from "@/lib/types";

let directory: string | undefined;

async function setup(events: ParsedSession["events"]) {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-api-"));
  process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
  const database = await import("@/lib/server/db");
  database.closeDb();
  const repository = await import("@/lib/server/repository");
  await repository.saveParsedSession({
    id: "session-api",
    provider: "codex",
    externalId: "session-api",
    title: "API test",
    projectPath: null,
    sourcePath: "/tmp/api.jsonl",
    startedAt: null,
    updatedAt: null,
    model: null,
    available: true,
    events,
  });
  return { database, repository };
}

afterEach(async () => {
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("event APIs", () => {
  it("returns bounded previews and streams the complete local JSON", async () => {
    const raw = { output: "large local record ".repeat(40_000) };
    const { repository } = await setup([{
      sequence: 0, timestamp: null, kind: "tool_result", role: "tool", turnId: null, callId: "call-api",
      parentId: null, toolName: "api_tool", text: "large result", input: { prompt: "test" }, output: raw,
      status: "success", durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null,
      externalId: "event-api", raw,
    }]);
    const eventId = repository.listEvents("session-api")[0].id;
    const route = await import("@/app/api/events/[id]/route");

    const previewResponse = await route.GET(new Request(`http://localhost/api/events/${eventId}?part=raw`), { params: Promise.resolve({ id: eventId }) });
    const preview = await previewResponse.json();
    const downloadResponse = await route.GET(new Request(`http://localhost/api/events/${eventId}?part=raw&mode=download`), { params: Promise.resolve({ id: eventId }) });
    const invalidResponse = await route.GET(new Request(`http://localhost/api/events/${eventId}?part=missing`), { params: Promise.resolve({ id: eventId }) });

    expect(preview.text.length).toBeLessThanOrEqual(256 * 1024);
    expect(preview.truncated).toBe(true);
    expect(preview.bytes).toBeGreaterThan(256 * 1024);
    expect(downloadResponse.headers.get("content-disposition")).toContain(`${eventId}-raw.json`);
    expect(JSON.parse(await downloadResponse.text())).toEqual(raw);
    expect(invalidResponse.status).toBe(400);
  });

  it("keeps the legacy payload while summary mode clamps paging and anchors", async () => {
    const events: ParsedSession["events"] = Array.from({ length: 205 }, (_, sequence) => ({
      sequence, timestamp: null, kind: "metadata" as const, role: null, turnId: null, callId: null,
      parentId: null, toolName: null, text: `event ${sequence}`, input: { sequence }, output: null,
      status: null, durationMs: null, inputTokens: null, outputTokens: null, totalTokens: null,
      externalId: `event-${sequence}`, raw: { sequence },
    }));
    const { repository } = await setup(events);
    const anchor = repository.listEvents("session-api", [], 205)[202].id;
    const route = await import("@/app/api/sessions/[id]/events/route");
    const context = { params: Promise.resolve({ id: "session-api" }) };
    const response = await route.GET(new NextRequest(`http://localhost/api/sessions/session-api/events?mode=summary&limit=999&offset=-20&anchor=${anchor}`), context);
    const body = await response.json() as EventPageResponse;
    const legacyResponse = await route.GET(new NextRequest("http://localhost/api/sessions/session-api/events?limit=1"), context);
    const legacy = await legacyResponse.json();

    expect(body.offset).toBe(200);
    expect(body.data).toHaveLength(5);
    expect(body.data.some((event) => event.id === anchor)).toBe(true);
    expect(body.data[0]).not.toHaveProperty("input");
    expect(body.previousOffset).toBe(0);
    expect(body.nextOffset).toBeNull();
    expect(legacy.data[0]).toHaveProperty("input");
  });
});
