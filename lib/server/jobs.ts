import "server-only";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ImportDiagnostic, JobRecord, ParsedSession, ProviderId, SourceAdapter } from "@/lib/types";
import { claudeCodeAdapter, claudeDesktopAdapter, codexAdapter, cursorAdapter, detectAdapter } from "@/lib/adapters";
import { getDb } from "./db";
import { mapJob, saveParsedSession } from "./repository";

type SourceFile = { path: string; adapter: SourceAdapter; provider: ProviderId; displayPath?: string; temporary?: boolean };

declare global {
  var __aiLogJobControllers: Map<string, AbortController> | undefined;
}

const controllers = global.__aiLogJobControllers || new Map<string, AbortController>();
global.__aiLogJobControllers = controllers;

export function recoverOrphanedJobs() {
  const db = getDb();
  const active = db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running')").all() as Array<{ id: string }>;
  for (const job of active) {
    if (!controllers.has(job.id)) {
      updateJob(job.id, { status: "cancelled", message: "Interrupted by application restart" });
    }
  }
}

async function walk(root: string, accept: (filePath: string) => boolean, output: string[]) {
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(root, entry.name);
      if (entry.isDirectory()) await walk(next, accept, output);
      else if (entry.isFile() && accept(next)) output.push(next);
    }
  } catch { /* Missing or inaccessible source roots are expected. */ }
}

export async function discoverKnownSources() {
  const home = os.homedir();
  const result: SourceFile[] = [];
  const addTree = async (root: string, adapter: SourceAdapter, accept: (filePath: string) => boolean) => {
    const files: string[] = [];
    await walk(root, accept, files);
    files.forEach((filePath) => result.push({ path: filePath, adapter, provider: adapter.id }));
  };
  await addTree(path.join(home, ".claude", "projects"), claudeCodeAdapter, (file) => file.endsWith(".jsonl"));
  await addTree(path.join(home, ".codex", "sessions"), codexAdapter, (file) => file.endsWith(".jsonl"));
  await addTree(path.join(home, ".codex", "archived_sessions"), codexAdapter, (file) => file.endsWith(".jsonl"));
  await addTree(path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"), claudeDesktopAdapter, (file) => file.endsWith("audit.jsonl"));
  const cursorPath = path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  try { await fsp.access(cursorPath); result.push({ path: cursorPath, adapter: cursorAdapter, provider: "cursor" }); } catch { /* optional */ }
  return result;
}

async function fingerprint(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

function createJob(kind: JobRecord["kind"]) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO jobs (id,kind,status,created_at,updated_at) VALUES (?,?, 'queued',?,?)").run(id, kind, now, now);
  return id;
}

function updateJob(id: string, values: Record<string, unknown>) {
  const db = getDb();
  const names = Object.keys(values);
  db.prepare(`UPDATE jobs SET ${names.map((name) => `${name}=@${name}`).join(",")}, updated_at=@updated_at WHERE id=@id`)
    .run({ ...values, id, updated_at: new Date().toISOString() });
}

function diagnostic(jobId: string, value: ImportDiagnostic) {
  getDb().prepare("INSERT INTO diagnostics (job_id,provider,source_path,severity,message,line,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(jobId, value.provider || null, value.sourcePath, value.severity, value.message, value.line || null, new Date().toISOString());
}

function isDiagnostic(value: ParsedSession | ImportDiagnostic): value is ImportDiagnostic {
  return "severity" in value;
}

async function runFiles(jobId: string, sources: SourceFile[], signal: AbortSignal) {
  const db = getDb();
  updateJob(jobId, { status: "running", total_files: sources.length, message: "Discovering local histories" });
  const seen = new Set<string>();
  let processedFiles = 0;
  let processedEvents = 0;
  for (const source of sources) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const recordPath = source.displayPath || source.path;
    seen.add(recordPath);
    let stat;
    try { stat = await fsp.stat(source.path); }
    catch (error) { diagnostic(jobId, { provider: source.provider, sourcePath: source.path, severity: "error", message: error instanceof Error ? error.message : "Source unavailable" }); continue; }
    const existing = db.prepare("SELECT size,mtime_ms,fingerprint,error FROM source_files WHERE path=?").get(recordPath) as { size: number; mtime_ms: number; fingerprint: string; error: string | null } | undefined;
    if (existing && !existing.error && existing.size === stat.size && existing.mtime_ms === stat.mtimeMs) {
      processedFiles += 1;
      updateJob(jobId, { processed_files: processedFiles, progress: sources.length ? processedFiles / sources.length : 1, message: `Unchanged: ${path.basename(source.path)}` });
      continue;
    }
    const digest = await fingerprint(source.path);
    if (existing?.fingerprint === digest && !existing.error) {
      db.prepare("UPDATE source_files SET size=?,mtime_ms=?,available=1,last_indexed_at=?,error=NULL WHERE path=?").run(stat.size, stat.mtimeMs, new Date().toISOString(), recordPath);
    } else {
      let fileEvents = 0;
      db.prepare("DELETE FROM diagnostics WHERE source_path=? OR source_path=?").run(source.path, recordPath);
      const heartbeat = setInterval(() => {
        updateJob(jobId, {
          processed_files: processedFiles,
          processed_events: processedEvents + fileEvents,
          progress: sources.length ? processedFiles / sources.length : 0,
          message: `Indexing ${path.basename(source.path)}…`,
        });
      }, 1000);
      try {
        for await (const value of source.adapter.parse(source.path)) {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          if (isDiagnostic(value)) diagnostic(jobId, value);
          else { await saveParsedSession({ ...value, sourcePath: recordPath }); fileEvents += value.events.length; }
          if (fileEvents % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
        }
        db.prepare(`INSERT INTO source_files (path,provider,size,mtime_ms,fingerprint,available,last_indexed_at,error)
          VALUES (?,?,?,?,?,1,?,NULL) ON CONFLICT(path) DO UPDATE SET provider=excluded.provider,size=excluded.size,
          mtime_ms=excluded.mtime_ms,fingerprint=excluded.fingerprint,available=1,last_indexed_at=excluded.last_indexed_at,error=NULL`)
          .run(recordPath, source.provider, stat.size, stat.mtimeMs, digest, new Date().toISOString());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        const message = error instanceof Error ? error.message : "Parser failed";
        db.prepare(`INSERT INTO source_files (path,provider,size,mtime_ms,fingerprint,available,last_indexed_at,error)
          VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(path) DO UPDATE SET error=excluded.error,last_indexed_at=excluded.last_indexed_at`).run(recordPath, source.provider, stat.size, stat.mtimeMs, digest, new Date().toISOString(), message);
        diagnostic(jobId, { provider: source.provider, sourcePath: recordPath, severity: "error", message });
      } finally {
        clearInterval(heartbeat);
      }
      processedEvents += fileEvents;
    }
    processedFiles += 1;
    updateJob(jobId, { processed_files: processedFiles, processed_events: processedEvents, progress: sources.length ? processedFiles / sources.length : 1, message: `Indexed ${path.basename(source.path)}` });
  }
  if (jobId && sources.length && sources.some((source) => source.path.startsWith(os.homedir()))) {
    const known = db.prepare("SELECT path FROM source_files").all() as Array<{ path: string }>;
    known.filter((item) => !seen.has(item.path) && item.path.startsWith(os.homedir())).forEach((item) => {
      db.prepare("UPDATE source_files SET available=0 WHERE path=?").run(item.path);
      db.prepare("UPDATE sessions SET available=0 WHERE source_path=?").run(item.path);
    });
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE sources SET status=CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE sessions.provider=sources.id) THEN 'ready' ELSE 'empty' END, last_scan_at=?`).run(now);
  const encryptedDir = path.join(os.homedir(), "Library", "Application Support", "com.openai.chat");
  const encrypted: string[] = [];
  await walk(encryptedDir, (file) => file.endsWith(".data") && file.includes("conversations-v3"), encrypted);
  if (encrypted.length) db.prepare("UPDATE sources SET status='warning',note=? WHERE id='chatgpt'").run(`Encrypted desktop cache detected (${encrypted.length} files). Import an official data export.`);
  updateJob(jobId, { status: "completed", progress: 1, processed_files: processedFiles, processed_events: processedEvents, message: `Indexed ${processedFiles} files` });
  db.pragma("wal_checkpoint(TRUNCATE)");
}

function launch(jobId: string, sourcesPromise: Promise<SourceFile[]>) {
  const controller = new AbortController();
  controllers.set(jobId, controller);
  void sourcesPromise.then((sources) => runFiles(jobId, sources, controller.signal)).catch((error) => {
    updateJob(jobId, { status: error?.name === "AbortError" ? "cancelled" : "failed", message: error instanceof Error ? error.message : "Job failed" });
  }).finally(() => controllers.delete(jobId));
}

export function startScan() {
  recoverOrphanedJobs();
  const active = getDb().prepare("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (active) return mapJob(active);
  const id = createJob("scan");
  launch(id, discoverKnownSources());
  return getJob(id)!;
}

export async function startImport(filePath: string, originalName: string) {
  const id = createJob("import");
  const controller = new AbortController();
  controllers.set(id, controller);
  const adapter = await detectAdapter(filePath);
  if (!adapter) {
    diagnostic(id, { sourcePath: originalName, severity: "error", message: "Unsupported file. Choose Claude/Codex JSONL, Cursor state.vscdb, or a conversation export JSON file." });
    updateJob(id, { status: "failed", message: "Unsupported file" });
    controllers.delete(id);
    await fsp.rm(path.dirname(filePath), { recursive: true, force: true }).catch(() => undefined);
    return getJob(id)!;
  }
  const source: SourceFile = { path: filePath, adapter, provider: adapter.id, displayPath: `Imported · ${originalName}`, temporary: true };
  void runFiles(id, [source], controller.signal).catch((error) => {
    updateJob(id, { status: error?.name === "AbortError" ? "cancelled" : "failed", message: error instanceof Error ? error.message : "Import failed" });
  }).finally(async () => { controllers.delete(id); await fsp.rm(path.dirname(filePath), { recursive: true, force: true }).catch(() => undefined); });
  return getJob(id)!;
}

export function getJob(id: string) {
  recoverOrphanedJobs();
  const db = getDb();
  const row = db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const diagnostics = db.prepare("SELECT provider,source_path sourcePath,severity,message,line FROM diagnostics WHERE job_id=? ORDER BY id DESC LIMIT 50").all(id) as ImportDiagnostic[];
  const count = db.prepare("SELECT COUNT(*) count FROM diagnostics WHERE job_id=?").get(id) as { count: number };
  return { ...mapJob(row), diagnosticCount: count.count, diagnostics };
}

export function cancelJob(id: string) {
  controllers.get(id)?.abort();
  updateJob(id, { cancel_requested: 1, message: "Cancelling…" });
  return getJob(id);
}
