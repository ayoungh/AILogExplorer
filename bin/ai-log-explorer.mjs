#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

export const DEFAULT_PORT = 3000;
export const LAST_FALLBACK_PORT = 3010;

export function helpText() {
  return `AI Log Explorer ${packageJson.version}

Usage:
  ai-log-explorer [--port <port>] [--no-open]
  ai-log-explorer --version
  ai-log-explorer --help

Options:
  --port <port>  Listen on an explicit loopback port (default: first free from 3000-3010)
  --no-open      Do not open the browser after startup
  --version      Print the installed version
  --help         Show this help
`;
}

export function parseArgs(argv) {
  const options = { port: null, open: true, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--version" || argument === "-v") options.version = true;
    else if (argument === "--no-open") options.open = false;
    else if (argument === "--port") {
      const value = argv[index + 1];
      if (!value) throw new Error("--port requires a value.");
      options.port = parsePort(value);
      index += 1;
    } else if (argument.startsWith("--port=")) options.port = parsePort(argument.slice(7));
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}. Expected an integer from 1 to 65535.`);
  }
  return port;
}

export function validateRuntime({ platform = process.platform, arch = process.arch, version = process.versions.node } = {}) {
  if (platform !== "darwin") throw new Error("AI Log Explorer currently supports macOS only.");
  if (!new Set(["arm64", "x64"]).has(arch)) throw new Error(`Unsupported Mac architecture: ${arch}.`);
  if (Number(version.split(".")[0]) !== 24) throw new Error(`AI Log Explorer requires Node.js 24.x (current: ${version}).`);
}

export function defaultDatabasePath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, "Library", "Application Support", "AI Log Explorer", "ailogexplorer.sqlite");
}

export async function isPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export async function choosePort(explicitPort) {
  if (explicitPort !== null) {
    if (!(await isPortAvailable(explicitPort))) throw new Error(`Port ${explicitPort} is unavailable.`);
    return explicitPort;
  }
  for (let port = DEFAULT_PORT; port <= LAST_FALLBACK_PORT; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available loopback port from ${DEFAULT_PORT} to ${LAST_FALLBACK_PORT}.`);
}

async function waitForHealth(url, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before becoming ready (code ${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Startup commonly needs several attempts.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Server did not become ready within 20 seconds.");
}

function openBrowser(url) {
  const opener = spawn("open", [url], { detached: true, stdio: "ignore" });
  opener.unref();
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  validateRuntime();
  const port = await choosePort(options.port);
  const appDirectory = path.join(packageRoot, "dist", "app");
  const buildId = path.join(appDirectory, ".next", "BUILD_ID");
  if (!fs.existsSync(buildId)) throw new Error("The installed package is missing its production build.");

  const nextBin = require.resolve("next/dist/bin/next");
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [nextBin, "start", appDirectory, "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        AILOG_DB_PATH: process.env.AILOG_DB_PATH || defaultDatabasePath(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "inherit",
    },
  );

  const forwardSignal = (signal) => {
    if (child.exitCode === null) child.kill(signal);
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await waitForHealth(`${url}/api/health`, child);
    process.stdout.write(`AI Log Explorer is ready at ${url}\n`);
    if (options.open) openBrowser(url);
    const result = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    return result.signal ? 1 : result.code ?? 1;
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

async function main() {
  try {
    process.exitCode = await run();
  } catch (error) {
    process.stderr.write(`ai-log-explorer: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
