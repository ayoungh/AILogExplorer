import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

let directory: string | undefined;

async function prepare() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-live-"));
  process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
  const database = await import("@/lib/server/db");
  database.closeDb();
  const live = await import("@/lib/server/live");
  live.resetLiveInfrastructureForTests();
  return { database, live };
}

afterEach(async () => {
  vi.useRealTimers();
  const live = await import("@/lib/server/live");
  live.resetLiveInfrastructureForTests();
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("live update infrastructure", () => {
  it("starts watchers only for enabled clients, coalesces changes, and defers a rescan behind active work", async () => {
    vi.useFakeTimers();
    const { live } = await prepare();
    const root = path.join(directory!, "provider-root");
    await fs.mkdir(root);
    let onChange: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
    let closed = 0;
    let scans = 0;
    let active = false;
    live.configureLiveInfrastructure({
      roots: () => [root],
      startScan: () => { scans += 1; },
      hasActiveJob: () => active,
      debounceMs: 50,
      watch: (_root, callback) => { onChange = callback; return { close: () => { closed += 1; } }; },
    });
    live.setLiveUpdatesEnabled(true);
    expect(live.liveDebugSnapshot().watchers).toBe(0);
    const unregister = live.registerLiveClient();
    expect(live.liveDebugSnapshot()).toMatchObject({ clients: 1, watchers: 1 });

    onChange?.("change", "one.jsonl");
    onChange?.("change", "two.jsonl");
    onChange?.("change", "ignored.txt");
    await vi.advanceTimersByTimeAsync(60);
    expect(scans).toBe(1);

    active = true;
    onChange?.("change", "three.jsonl");
    expect(live.liveDebugSnapshot().pendingRescan).toBe(true);
    active = false;
    live.notifyJobSettled();
    await vi.advanceTimersByTimeAsync(60);
    expect(scans).toBe(2);

    unregister();
    expect(live.liveDebugSnapshot()).toMatchObject({ clients: 0, watchers: 0, pendingRescan: false });
    expect(closed).toBe(1);
  });

  it("defaults live updates off until a completed scan and respects an explicit setting", async () => {
    const { database, live } = await prepare();
    expect(live.getLiveSettings()).toMatchObject({ liveUpdates: false, explicit: false });
    const now = new Date().toISOString();
    database.getDb().prepare("INSERT INTO jobs (id,kind,status,created_at,updated_at) VALUES ('scan-1','scan','completed',?,?)").run(now, now);
    expect(live.getLiveSettings()).toMatchObject({ liveUpdates: true, explicit: false });
    expect(live.setLiveUpdatesEnabled(false)).toMatchObject({ liveUpdates: false, explicit: true });
  });

  it("streams typed events and releases the live client on abort", async () => {
    const { live } = await prepare();
    const streamRoute = await import("@/app/api/stream/route");
    live.resetLiveInfrastructureForTests();
    live.configureLiveInfrastructure({ roots: () => [], startScan: () => undefined, hasActiveJob: () => false });
    const controller = new AbortController();
    const response = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      signal: controller.signal,
      headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210", "sec-fetch-site": "same-origin" },
    }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: connected");
    live.emitLiveEvent("job-updated", { id: "job-1" });
    const update = decoder.decode((await reader.read()).value);
    expect(update).toContain("event: job-updated");
    expect(update).toContain("job-1");
    expect(live.liveDebugSnapshot().clients).toBe(1);
    controller.abort();
    await Promise.resolve();
    expect(live.liveDebugSnapshot().clients).toBe(0);
  });

  it("rejects foreign browser contexts before allocating live resources", async () => {
    const { live } = await prepare();
    const streamRoute = await import("@/app/api/stream/route");
    live.resetLiveInfrastructureForTests();
    const watch = vi.fn(() => ({ close: vi.fn() }));
    live.configureLiveInfrastructure({ roots: () => [directory!], startScan: () => undefined, hasActiveJob: () => false, watch });
    live.setLiveUpdatesEnabled(true);

    const foreignOrigin = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      headers: { host: "127.0.0.1:3210", origin: "https://attacker.example" },
    }));
    expect(foreignOrigin.status).toBe(403);

    const originlessCrossSite = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      headers: { host: "127.0.0.1:3210", "sec-fetch-site": "cross-site" },
    }));
    const originlessSameSite = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      headers: { host: "127.0.0.1:3210", "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" },
    }));
    const missingBrowserContext = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      headers: { host: "127.0.0.1:3210" },
    }));
    expect(originlessCrossSite.status).toBe(403);
    expect(originlessSameSite.status).toBe(403);
    expect(missingBrowserContext.status).toBe(403);
    expect(foreignOrigin.headers.get("content-type")).not.toContain("text/event-stream");
    expect(originlessCrossSite.headers.get("content-type")).not.toContain("text/event-stream");
    expect(live.liveDebugSnapshot()).toMatchObject({ clients: 0, watchers: 0 });
    expect(watch).not.toHaveBeenCalled();
  });

  it("accepts an originless same-origin browser stream context", async () => {
    const { live } = await prepare();
    const streamRoute = await import("@/app/api/stream/route");
    live.resetLiveInfrastructureForTests();
    live.configureLiveInfrastructure({ roots: () => [], startScan: () => undefined, hasActiveJob: () => false });
    const controller = new AbortController();
    const response = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      signal: controller.signal,
      headers: { host: "127.0.0.1:3210", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(live.liveDebugSnapshot().clients).toBe(1);
    controller.abort();
    await Promise.resolve();
    expect(live.liveDebugSnapshot().clients).toBe(0);
  });

  it("does not allocate live resources for an already-aborted request", async () => {
    const { live } = await prepare();
    const streamRoute = await import("@/app/api/stream/route");
    live.resetLiveInfrastructureForTests();
    const watch = vi.fn(() => ({ close: vi.fn() }));
    live.configureLiveInfrastructure({ roots: () => [directory!], startScan: () => undefined, hasActiveJob: () => false, watch });
    live.setLiveUpdatesEnabled(true);
    const controller = new AbortController();
    controller.abort();
    const response = streamRoute.GET(new NextRequest("http://127.0.0.1:3210/api/stream", {
      signal: controller.signal,
      headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" },
    }));
    expect(response.status).toBe(499);
    expect(live.liveDebugSnapshot()).toMatchObject({ clients: 0, watchers: 0 });
    expect(watch).not.toHaveBeenCalled();
  });
});

describe("settings route", () => {
  it("requires a local same-origin mutation and persists a boolean", async () => {
    const { live } = await prepare();
    const route = await import("@/app/api/settings/route");
    live.resetLiveInfrastructureForTests();
    live.configureLiveInfrastructure({ roots: () => [], startScan: () => undefined, hasActiveJob: () => false });
    const rejected = await route.PATCH(new NextRequest("http://127.0.0.1:3210/api/settings", {
      method: "PATCH", headers: { host: "127.0.0.1:3210", origin: "http://localhost:3210", "content-type": "application/json" }, body: JSON.stringify({ liveUpdates: true }),
    }));
    expect(rejected.status).toBe(403);
    const accepted = await route.PATCH(new NextRequest("http://127.0.0.1:3210/api/settings", {
      method: "PATCH", headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210", "content-type": "application/json" }, body: JSON.stringify({ liveUpdates: true }),
    }));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ liveUpdates: true, explicit: true });
    expect(await (await route.GET()).json()).toMatchObject({ liveUpdates: true, explicit: true });
  });
});
