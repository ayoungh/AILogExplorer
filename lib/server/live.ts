import "server-only";
import { EventEmitter } from "node:events";
import fs, { type FSWatcher } from "node:fs";
import { getDb } from "./db";

export type LiveEventType = "job-updated" | "session-updated" | "index-updated" | "settings-updated";

export type LiveEvent = {
  id: number;
  type: LiveEventType;
  at: string;
  data: unknown;
};

type WatchHandle = Pick<FSWatcher, "close"> & { on?: (event: "error", listener: () => void) => unknown };
type WatchFactory = (root: string, onChange: (eventType: string, filename: string | Buffer | null) => void) => WatchHandle;
type LiveConfiguration = {
  roots: () => string[];
  startScan: () => unknown;
  hasActiveJob: () => boolean;
  watch?: WatchFactory;
  debounceMs?: number;
};

type LiveState = {
  emitter: EventEmitter;
  watchers: Map<string, WatchHandle>;
  clients: number;
  revision: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingRescan: boolean;
  configuration: LiveConfiguration | null;
};

declare global {
  var __aiLogLiveState: LiveState | undefined;
}

function createState(): LiveState {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return { emitter, watchers: new Map(), clients: 0, revision: 0, timer: null, pendingRescan: false, configuration: null };
}

const state = global.__aiLogLiveState || createState();
global.__aiLogLiveState = state;

function defaultWatch(root: string, onChange: (eventType: string, filename: string | Buffer | null) => void) {
  return fs.watch(root, { recursive: true }, onChange);
}

function explicitSetting() {
  const row = getDb().prepare("SELECT value_json,updated_at FROM settings WHERE key='liveUpdates'").get() as { value_json: string; updated_at: string } | undefined;
  if (!row) return { value: null, updatedAt: null };
  try {
    const value = JSON.parse(row.value_json);
    return { value: value === true ? true : false, updatedAt: row.updated_at };
  }
  catch { return { value: false, updatedAt: row.updated_at }; }
}

export function getLiveSettings() {
  const explicit = explicitSetting();
  const completedScan = Boolean(getDb().prepare("SELECT 1 FROM jobs WHERE kind='scan' AND status='completed' LIMIT 1").get());
  return { liveUpdates: explicit.value ?? completedScan, explicit: explicit.value !== null, updatedAt: explicit.updatedAt };
}

function relevantFilename(filename: string | Buffer | null) {
  if (filename == null) return true;
  const value = filename.toString().toLowerCase();
  return value.endsWith(".jsonl") || value.endsWith("state.vscdb");
}

function closeWatchers() {
  for (const watcher of state.watchers.values()) {
    try { watcher.close(); } catch { /* Already closed by the platform. */ }
  }
  state.watchers.clear();
}

function clearPendingWork() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.pendingRescan = false;
}

function runScheduledScan() {
  state.timer = null;
  const configuration = state.configuration;
  if (!configuration || !getLiveSettings().liveUpdates || state.clients < 1) return;
  if (configuration.hasActiveJob()) {
    state.pendingRescan = true;
    return;
  }
  state.pendingRescan = false;
  configuration.startScan();
}

export function scheduleLiveScan() {
  const configuration = state.configuration;
  if (!configuration || !getLiveSettings().liveUpdates || state.clients < 1) return;
  if (configuration.hasActiveJob()) {
    state.pendingRescan = true;
    return;
  }
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(runScheduledScan, configuration.debounceMs ?? 500);
}

export function reconcileLiveWatchers() {
  const configuration = state.configuration;
  if (!configuration || !getLiveSettings().liveUpdates || state.clients < 1) {
    closeWatchers();
    clearPendingWork();
    return;
  }
  const roots = new Set(configuration.roots().filter((root) => {
    try { return fs.statSync(root).isDirectory(); } catch { return false; }
  }));
  for (const [root, watcher] of state.watchers) {
    if (!roots.has(root)) { try { watcher.close(); } catch { /* no-op */ } state.watchers.delete(root); }
  }
  const watch = configuration.watch || defaultWatch;
  for (const root of roots) {
    if (state.watchers.has(root)) continue;
    try {
      const watcher = watch(root, (_eventType, filename) => {
        if (relevantFilename(filename)) scheduleLiveScan();
      });
      watcher.on?.("error", () => {
        try { watcher.close(); } catch { /* no-op */ }
        state.watchers.delete(root);
      });
      state.watchers.set(root, watcher);
    } catch { /* Missing, inaccessible, or temporarily unavailable roots are skipped. */ }
  }
}

export function configureLiveInfrastructure(configuration: LiveConfiguration) {
  state.configuration = configuration;
  reconcileLiveWatchers();
}

export function emitLiveEvent(type: LiveEventType, data: unknown) {
  const value: LiveEvent = { id: ++state.revision, type, at: new Date().toISOString(), data };
  state.emitter.emit("event", value);
  return value;
}

export function subscribeLiveEvents(listener: (event: LiveEvent) => void) {
  state.emitter.on("event", listener);
  return () => state.emitter.off("event", listener);
}

export function registerLiveClient() {
  state.clients += 1;
  reconcileLiveWatchers();
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    state.clients = Math.max(0, state.clients - 1);
    reconcileLiveWatchers();
  };
}

export function setLiveUpdatesEnabled(enabled: boolean) {
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO settings (key,value_json,updated_at) VALUES ('liveUpdates',?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(JSON.stringify(enabled), now);
  if (!enabled) { closeWatchers(); clearPendingWork(); }
  else reconcileLiveWatchers();
  const settings = getLiveSettings();
  emitLiveEvent("settings-updated", settings);
  return settings;
}

export function notifyJobSettled() {
  reconcileLiveWatchers();
  const configuration = state.configuration;
  if (!state.pendingRescan || !configuration || configuration.hasActiveJob() || !getLiveSettings().liveUpdates || state.clients < 1) return;
  state.pendingRescan = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(runScheduledScan, configuration.debounceMs ?? 500);
}

export function liveDebugSnapshot() {
  return { clients: state.clients, watchers: state.watchers.size, pendingRescan: state.pendingRescan, configured: Boolean(state.configuration) };
}

export function resetLiveInfrastructureForTests() {
  closeWatchers();
  clearPendingWork();
  state.emitter.removeAllListeners();
  state.clients = 0;
  state.revision = 0;
  state.configuration = null;
}
