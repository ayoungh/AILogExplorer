import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_FIXTURE_PATHS } from "./example-fixtures.mjs";

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

const privateExtensions = new Map([
  [".avi", "recorded media"],
  [".bmp", "image"],
  [".data", "AI history or application data"],
  [".db", "database"],
  [".gif", "image"],
  [".heic", "image"],
  [".jpeg", "image"],
  [".jpg", "image"],
  [".jsonl", "AI log export"],
  [".m4v", "recorded media"],
  [".mov", "recorded media"],
  [".mp4", "recorded media"],
  [".pdf", "binary document"],
  [".png", "image or screenshot"],
  [".sqlite", "database"],
  [".sqlite3", "database"],
  [".tiff", "image"],
  [".vscdb", "database"],
  [".webp", "image"],
]);

const syntheticFixturePaths = new Set(EXAMPLE_FIXTURE_PATHS);
const approvedShowcasePaths = new Set([
  "data-map-screenshot.png",
  "screenshot.png",
]);

const privateDirectoryNames = new Set([
  ".data",
  ".next",
  ".pnpm-store",
  "coverage",
  "exports",
  "node_modules",
  "screenshots",
]);

const credentialPatterns = [
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

const exampleEmailDomains = new Set([
  "example.com",
  "example.net",
  "example.org",
  "example.invalid",
]);

function normalizeCandidatePath(candidatePath) {
  return candidatePath.split(path.sep).join("/");
}

export function pathPolicyIssues(candidatePath) {
  const normalized = normalizeCandidatePath(candidatePath);
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) || normalized;
  const lowerBasename = basename.toLowerCase();
  const extension = path.extname(lowerBasename);
  const isSyntheticFixture = syntheticFixturePaths.has(normalized);
  const isApprovedShowcase = approvedShowcasePaths.has(normalized);
  const issues = [];

  if (segments.some((segment) => privateDirectoryNames.has(segment.toLowerCase()))) {
    issues.push("private or generated directory");
  }
  if (lowerBasename === ".env" || (lowerBasename.startsWith(".env.") && lowerBasename !== ".env.example")) {
    issues.push("environment file");
  }
  if (lowerBasename === ".ds_store" || lowerBasename.endsWith(".log") || lowerBasename.endsWith(".tsbuildinfo")) {
    issues.push("generated local file");
  }
  if (lowerBasename.endsWith("-wal") || lowerBasename.endsWith("-shm")) {
    issues.push("database sidecar");
  }
  if (privateExtensions.has(extension) && !isSyntheticFixture && !isApprovedShowcase) {
    issues.push(privateExtensions.get(extension));
  }

  return [...new Set(issues)];
}

export function contentPolicyIssues(content) {
  const issues = [];

  if (/\/Users\/[^/\s]+(?:\/|\\)/.test(content) || /[A-Za-z]:\\Users\\[^\\\s]+\\/i.test(content)) {
    issues.push("absolute user-home path");
  }

  const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
  for (const match of content.matchAll(emailPattern)) {
    if (!exampleEmailDomains.has(match[1].toLowerCase())) {
      issues.push("non-example email address");
      break;
    }
  }

  for (const { label, pattern } of credentialPatterns) {
    if (pattern.test(content)) issues.push(label);
  }

  return issues;
}

export function inspectCandidate(candidatePath, content = "") {
  return [...pathPolicyIssues(candidatePath), ...contentPolicyIssues(content)];
}

export function listCommitCandidates(cwd = process.cwd()) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "buffer" },
  );

  return output.toString("utf8").split("\0").filter(Boolean).sort();
}

export function checkPublicTree(cwd = process.cwd()) {
  const candidates = listCommitCandidates(cwd);
  const findings = [];

  for (const candidatePath of candidates) {
    const absolutePath = path.join(cwd, candidatePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) continue;

    const pathIssues = pathPolicyIssues(candidatePath);
    if (pathIssues.length) {
      findings.push({ path: candidatePath, issues: pathIssues });
      continue;
    }

    if (stat.size > MAX_TEXT_FILE_BYTES) {
      findings.push({ path: candidatePath, issues: ["file exceeds the public-review size limit"] });
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    const contentIssues = contentPolicyIssues(content);
    if (contentIssues.length) findings.push({ path: candidatePath, issues: contentIssues });
  }

  return { candidates, findings };
}

function main() {
  const { candidates, findings } = checkPublicTree();

  if (findings.length) {
    console.error("Public tree check failed:");
    for (const finding of findings) {
      console.error(`- ${finding.path}: ${finding.issues.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Public tree check passed (${candidates.length} candidate files).`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
