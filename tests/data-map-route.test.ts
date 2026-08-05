import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { event } from "@/lib/adapters/utils";

let directory: string | undefined;

async function prepare() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ailog-data-map-route-"));
  process.env.AILOG_DB_PATH = path.join(directory, "index.sqlite");
  const database = await import("@/lib/server/db");
  database.closeDb();
}

afterEach(async () => {
  const database = await import("@/lib/server/db");
  database.closeDb();
  delete process.env.AILOG_DB_PATH;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("data map sample route", () => {
  it("rejects unknown providers, concepts, and invalid indexes", async () => {
    await prepare();
    const { GET } = await import("@/app/api/data-map/sample/route");
    expect((await GET(new NextRequest("http://localhost/api/data-map/sample?provider=nope&concept=messages&index=0"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/data-map/sample?provider=codex&concept=nope&index=0"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/data-map/sample?provider=codex&concept=messages&index=-1"))).status).toBe(400);
  });

  it("returns a clear 404 when no local sample exists", async () => {
    await prepare();
    const { GET } = await import("@/app/api/data-map/sample/route");
    const response = await GET(new NextRequest("http://localhost/api/data-map/sample?provider=codex&concept=messages&index=0"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No sample is available" });
  });

  it("returns only the sanitized preview for a matching local sample", async () => {
    await prepare();
    const repository = await import("@/lib/server/repository");
    const privatePath = ["", "Users", "example", "private.ts"].join("/");
    await repository.saveParsedSession({
      id: "codex:data-map-route-test",
      provider: "codex",
      externalId: "data-map-route-test",
      title: "Data map route test",
      projectPath: "/example-workspace/data-map",
      sourcePath: "/example/codex.jsonl",
      startedAt: "2026-08-05T10:00:00Z",
      updatedAt: "2026-08-05T10:01:00Z",
      model: "example-model",
      available: true,
      events: [event({
        sequence: 0,
        kind: "tool_call",
        role: "assistant",
        toolName: "read_file",
        callId: "call-1",
        input: { api_key: "never-return", path: privatePath },
        raw: {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "read_file",
            arguments: {
              api_key: "never-return",
              email: "person@example.com",
              path: privatePath,
            },
          },
        },
      })],
    });

    const { GET } = await import("@/app/api/data-map/sample/route");
    const response = await GET(new NextRequest("http://localhost/api/data-map/sample?provider=codex&concept=tool-calls&index=0"));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("never-return");
    expect(body).not.toContain("person@example.com");
    expect(body).not.toContain(privatePath);
    expect(body).toContain("[redacted]");
  });
});
