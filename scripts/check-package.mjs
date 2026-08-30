import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stageRoot = path.join(root, "dist", "app");
const forbiddenExtensions = new Set([".data", ".db", ".jsonl", ".node", ".sqlite", ".sqlite3", ".vscdb", ".map"]);
const forbiddenSegments = new Set(["cache", "dev", "diagnostics", "types"]);
const sensitivePatterns = [
  { label: "personal macOS home path", pattern: /\/Users\/[^/\s]+\// },
  { label: "personal Windows home path", pattern: /[A-Za-z]:\\Users\\[^\\\s]+\\/i },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
];

function fail(message) {
  throw new Error(`Package check failed: ${message}`);
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`symbolic link is not allowed: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

if (packageJson.private) fail("package.json must not be private");
if (packageJson.name !== "ai-log-explorer") fail("unexpected package name");
if (packageJson.bin?.["ai-log-explorer"] !== "bin/ai-log-explorer.mjs") fail("unexpected CLI entry point");
if (packageJson.engines?.node !== "24.x") fail("Node engine must remain 24.x");
if (JSON.stringify(packageJson.os) !== JSON.stringify(["darwin"])) fail("package must remain macOS-only");
if (!fs.existsSync(path.join(stageRoot, ".next", "BUILD_ID"))) fail("staged production build is missing");

const stagedFiles = walk(stageRoot);
for (const absolute of stagedFiles) {
  const relative = path.relative(stageRoot, absolute).split(path.sep).join("/");
  const segments = relative.toLowerCase().split("/");
  const extension = path.extname(relative).toLowerCase();
  if (segments.some((segment) => forbiddenSegments.has(segment))) fail(`forbidden directory in staged build: ${relative}`);
  if (segments.includes("node_modules") && !/^\.next\/node_modules\/better-sqlite3-[a-f0-9]+\/(?:index\.js|package\.json)$/.test(relative)) {
    fail(`unexpected dependency content in staged build: ${relative}`);
  }
  if (forbiddenExtensions.has(extension)) fail(`forbidden file type in staged build: ${relative}`);
  const stat = fs.statSync(absolute);
  if (stat.size > 8 * 1024 * 1024) fail(`unexpectedly large staged file: ${relative}`);
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");
  for (const { label, pattern } of sensitivePatterns) if (pattern.test(content)) fail(`${label} in ${relative}`);
}

const sqliteWrapperFiles = stagedFiles
  .map((file) => path.relative(stageRoot, file).split(path.sep).join("/"))
  .filter((file) => file.startsWith(".next/node_modules/better-sqlite3-"));
if (sqliteWrapperFiles.length !== 0 && sqliteWrapperFiles.length !== 2) {
  fail("staged build must contain only the complete generated better-sqlite3 wrapper when one is required");
}

const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), "ai-log-explorer-npm-cache-"));
try {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const result = JSON.parse(output)[0];
  const allowedFiles = new Set(["package.json", "README.md", "LICENSE", "bin/ai-log-explorer.mjs"]);
  for (const entry of result.files) {
    if (!allowedFiles.has(entry.path) && !entry.path.startsWith("dist/app/")) fail(`unexpected tarball entry: ${entry.path}`);
  }
  for (const required of allowedFiles) {
    if (!result.files.some((entry) => entry.path === required)) fail(`missing tarball entry: ${required}`);
  }
  const cliEntry = result.files.find((entry) => entry.path === "bin/ai-log-explorer.mjs");
  if (!cliEntry || (cliEntry.mode & 0o111) === 0) fail("CLI entry point is not executable");
  if (!result.files.some((entry) => entry.path === "dist/app/.next/BUILD_ID")) fail("tarball omits the production build");
  console.log(`Package check passed (${result.files.length} files, ${result.size} packed bytes).`);
} finally {
  fs.rmSync(npmCache, { recursive: true, force: true });
}
