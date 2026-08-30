import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import packageJson from "@/package.json";
import { GET as health } from "@/app/api/health/route";

// The executable is intentionally plain ESM so the published package runs without transpilation.
// @ts-expect-error The executable does not need a declaration file.
const cli = await import("../bin/ai-log-explorer.mjs");

describe("npm package metadata", () => {
  it("exposes only the local Mac CLI and staged application", () => {
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "ai-log-explorer": "bin/ai-log-explorer.mjs" });
    expect(packageJson.files).toEqual(["bin/", "dist/app/"]);
    expect(packageJson.os).toEqual(["darwin"]);
    expect(packageJson.cpu).toEqual(["arm64", "x64"]);
    expect(packageJson.engines).toEqual({ node: "24.x" });
    expect(packageJson.scripts).not.toHaveProperty("postinstall");
    expect(packageJson.scripts).not.toHaveProperty("prepare");
  });

  it("keeps better-sqlite3 consumer-installed", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    expect(packageJson.dependencies).toHaveProperty("better-sqlite3");
    expect(config).toContain('serverExternalPackages: ["better-sqlite3"]');
  });
});

describe("published CLI", () => {
  it("parses supported options and rejects unsafe inputs", () => {
    expect(cli.parseArgs(["--port", "4321", "--no-open"])).toEqual({ port: 4321, open: false, help: false, version: false });
    expect(cli.parseArgs(["--port=4322"])).toMatchObject({ port: 4322 });
    expect(() => cli.parseArgs(["--host", "0.0.0.0"])).toThrow("Unknown option");
    expect(() => cli.parseArgs(["--port", "0"])).toThrow("Invalid port");
  });

  it("enforces the supported runtime", () => {
    expect(() => cli.validateRuntime({ platform: "darwin", arch: "arm64", version: "24.13.0" })).not.toThrow();
    expect(() => cli.validateRuntime({ platform: "linux", arch: "x64", version: "24.13.0" })).toThrow("macOS only");
    expect(() => cli.validateRuntime({ platform: "darwin", arch: "x64", version: "22.0.0" })).toThrow("Node.js 24.x");
  });

  it("uses Application Support for installed data", () => {
    expect(cli.defaultDatabasePath("/example/home")).toBe("/example/home/Library/Application Support/AI Log Explorer/ailogexplorer.sqlite");
  });
});

describe("health endpoint", () => {
  it("reveals readiness and version only", async () => {
    const response = health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version: packageJson.version });
  });
});
