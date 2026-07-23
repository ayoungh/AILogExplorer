import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { contentPolicyIssues } from "./check-public-tree.mjs";
import { cursorFixture, EXAMPLE_FIXTURE_PATHS, jsonlFixtures } from "./example-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "examples", "provider-native");
const checkOnly = process.argv.includes("--check");

function jsonlContent(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function sensitiveContentIssues(value) {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return contentPolicyIssues(content);
}

function assertSynthetic(value, label) {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  const issues = sensitiveContentIssues(content);
  if (issues.length) throw new Error(`${label} contains ${issues.join(", ")}`);
  if (!content.includes("\"synthetic\":true")) throw new Error(`${label} is missing its synthetic marker`);
  if (!content.includes("example-") && !content.includes("[Example]")) {
    throw new Error(`${label} is not clearly identified as example data`);
  }
}

function expectedCursorRows() {
  return cursorFixture.rows
    .map(({ key, value }) => ({ key, value: JSON.stringify(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function inspectCursorDatabase(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    const rows = db.prepare("SELECT key, value FROM cursorDiskKV ORDER BY key").all().map((row) => ({
      key: row.key,
      value: Buffer.isBuffer(row.value) ? row.value.toString("utf8") : String(row.value),
    }));
    return { tables, rows };
  } finally {
    db.close();
  }
}

function generateCursorDatabase(filePath) {
  const temporaryPath = `${filePath}.tmp`;
  fs.rmSync(temporaryPath, { force: true });
  const db = new Database(temporaryPath);
  try {
    db.pragma("journal_mode = DELETE");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB)");
    const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    db.transaction(() => {
      for (const { key, value } of cursorFixture.rows) insert.run(key, JSON.stringify(value));
    })();
  } finally {
    db.close();
  }
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporaryPath, filePath);
}

function checkFixtures() {
  const expectedPaths = new Set(EXAMPLE_FIXTURE_PATHS);
  const actualPaths = fs.existsSync(outputDirectory)
    ? fs.readdirSync(outputDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `examples/provider-native/${entry.name}`)
    : [];
  const unexpected = actualPaths.filter((candidate) => !expectedPaths.has(candidate));
  const missing = [...expectedPaths].filter((candidate) => !actualPaths.includes(candidate));
  if (unexpected.length || missing.length) {
    throw new Error(`Example fixture set differs: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`);
  }

  for (const [name, rows] of Object.entries(jsonlFixtures)) {
    const expected = jsonlContent(rows);
    const filePath = path.join(outputDirectory, name);
    const actual = fs.readFileSync(filePath, "utf8");
    assertSynthetic(actual, name);
    if (actual !== expected) throw new Error(`${name} differs from its canonical generated content`);
  }

  const cursorPath = path.join(outputDirectory, "cursor-example.vscdb");
  const actualCursor = inspectCursorDatabase(cursorPath);
  const expectedCursor = { tables: [...cursorFixture.tables].sort(), rows: expectedCursorRows() };
  assertSynthetic(actualCursor.rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) })), "cursor-example.vscdb");
  if (JSON.stringify(actualCursor) !== JSON.stringify(expectedCursor)) {
    throw new Error("cursor-example.vscdb contains unexpected schema or records");
  }
}

function generateFixtures() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [name, rows] of Object.entries(jsonlFixtures)) {
    fs.writeFileSync(path.join(outputDirectory, name), jsonlContent(rows), "utf8");
  }
  generateCursorDatabase(path.join(outputDirectory, "cursor-example.vscdb"));
}

try {
  if (checkOnly) {
    checkFixtures();
    console.log(`Example fixtures passed (${EXAMPLE_FIXTURE_PATHS.length} generated files).`);
  } else {
    generateFixtures();
    checkFixtures();
    console.log(`Generated ${EXAMPLE_FIXTURE_PATHS.length} privacy-safe example fixtures.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
