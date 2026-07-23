"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, CheckCircle2, ChevronDown, FileJson2, FolderOpen, Import, Menu, MoreHorizontal, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventKind, JobRecord, NormalizedEvent, NormalizedSession, OverviewResponse, ProviderId } from "@/lib/types";
import { EventCard } from "./event-card";
import { EventInspector } from "./event-inspector";
import { ProviderMark } from "./provider-mark";

const filterGroups: Array<{ id: string; label: string; kinds: EventKind[] }> = [
  { id: "all", label: "All events", kinds: [] },
  { id: "messages", label: "Messages", kinds: ["user_message", "assistant_message"] },
  { id: "tools", label: "Tool calls", kinds: ["tool_call", "tool_result"] },
  { id: "reasoning", label: "Reasoning", kinds: ["reasoning"] },
  { id: "system", label: "System", kinds: ["system", "metadata", "usage", "error", "attachment", "unknown"] },
];

function formatRelative(value: string | null | undefined) {
  if (!value) return "Never";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function sessionTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 5) : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
  return response.json() as Promise<T>;
}

export function Explorer() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>((params.get("provider") as ProviderId) || null);
  const [sessions, setSessions] = useState<NormalizedSession[]>([]);
  const [sessionId, setSessionId] = useState(params.get("session"));
  const [requestedEventId] = useState(params.get("event"));
  const [session, setSession] = useState<NormalizedSession | null>(null);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<NormalizedEvent | null>(null);
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [view, setView] = useState<"timeline" | "conversation">(
    (params.get("view") as "timeline" | "conversation") || "timeline",
  );
  const [inspectorTab, setInspectorTab] = useState<"normalized" | "raw">("normalized");
  const [query, setQuery] = useState(params.get("search") || "");
  const [searchResults, setSearchResults] = useState<Array<NormalizedEvent & { snippet?: string; provider?: ProviderId }>>([]);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sessionScroll = useRef<HTMLDivElement>(null);

  const refreshOverview = useCallback(async () => {
    const data = await fetchJson<OverviewResponse>("/api/overview");
    setOverview(data);
    if (!provider) setProvider(data.providers.find((item) => item.sessionCount > 0)?.id || data.providers[0]?.id || "claude-code");
    if (data.activeJob) setJob(data.activeJob);
  }, [provider]);

  useEffect(() => { void refreshOverview().catch((reason) => setError(reason.message)); }, [refreshOverview]);

  useEffect(() => {
    if (!provider) return;
    void fetchJson<{ data: NormalizedSession[] }>(`/api/sessions?provider=${provider}&limit=250`).then(({ data }) => {
      setSessions(data);
      if (!sessionId || !data.some((item) => item.id === sessionId)) setSessionId(data[0]?.id || null);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load sessions"));
  }, [provider, overview?.totalSessions, sessionId]);

  useEffect(() => {
    if (!sessionId) { setSession(null); setEvents([]); return; }
    const group = filterGroups.find((item) => item.id === filter) || filterGroups[0];
    const kinds = group.kinds.map((kind) => `kind=${kind}`).join("&");
    void fetchJson<{ session: NormalizedSession; data: NormalizedEvent[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/events?limit=1000${kinds ? `&${kinds}` : ""}`).then((data) => {
      setSession(data.session);
      const filtered = view === "conversation" ? data.data.filter((item) => ["user_message", "assistant_message", "tool_call", "tool_result"].includes(item.kind)) : data.data;
      setEvents(filtered);
      setSelectedEvent((current) => filtered.find((item) => item.id === current?.id) || filtered.find((item) => item.id === requestedEventId) || filtered[0] || null);
    }).catch((reason) => {
      if (reason instanceof Error && reason.message === "Session not found") {
        setSessionId(null);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not load session events");
    });
  }, [sessionId, filter, view, requestedEventId]);

  const selectedEventId = selectedEvent?.id;
  useEffect(() => {
    if (!selectedEventId) return;
    void fetchJson<NormalizedEvent>(`/api/events/${selectedEventId}`).then(setSelectedEvent).catch(() => undefined);
  }, [selectedEventId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const values: Record<string, string | null> = { provider, session: sessionId, event: selectedEventId || null, filter, view, search: query.trim() || null };
    Object.entries(values).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    window.history.replaceState({}, "", url);
  }, [provider, sessionId, selectedEventId, filter, view, query]);

  useEffect(() => {
    if (query.trim().length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      void fetchJson<{ data: Array<NormalizedEvent & { snippet?: string; provider?: ProviderId }> }>(`/api/search?q=${encodeURIComponent(query)}`).then(({ data }) => setSearchResults(data)).catch(() => setSearchResults([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setInspectorOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = setInterval(() => {
      void fetchJson<JobRecord>(`/api/jobs/${job.id}`).then((next) => {
        setJob(next);
        if (!["queued", "running"].includes(next.status)) void refreshOverview();
      }).catch(() => undefined);
    }, 750);
    return () => clearInterval(timer);
  }, [job, refreshOverview]);

  // TanStack Virtual intentionally exposes mutable measurement helpers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({ count: sessions.length, getScrollElement: () => sessionScroll.current, estimateSize: () => 64, overscan: 8 });

  const startScan = async () => {
    setError(null);
    try { setJob(await fetchJson<JobRecord>("/api/jobs/scan", { method: "POST" })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Scan failed"); }
  };

  const waitForJob = async (value: JobRecord) => {
    let current = value;
    while (["queued", "running"].includes(current.status)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      current = await fetchJson<JobRecord>(`/api/jobs/${current.id}`);
      setJob(current);
    }
    return current;
  };

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const created = await fetchJson<JobRecord>("/api/jobs/import", { method: "POST", headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
        await waitForJob(created);
      } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not import ${file.name}`); }
    }
    await refreshOverview();
    if (fileRef.current) fileRef.current.value = "";
  };

  const chooseProvider = (value: ProviderId) => { setProvider(value); setSessionId(null); setSidebarOpen(false); };
  const chooseSession = (value: NormalizedSession) => { setSessionId(value.id); setSidebarOpen(false); };
  const chooseEvent = (value: NormalizedEvent) => { setSelectedEvent(value); setInspectorOpen(true); };

  return (
    <main className="app-frame">
      <header className="command-bar">
        <button className="mobile-menu" type="button" aria-label="Open sources and sessions" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
        <div className="wordmark"><FileJson2 size={25} strokeWidth={1.7} /><span>AI Log Explorer</span></div>
        <div className="search-shell">
          <Search size={17} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts, tools, paths…" aria-label="Search all indexed events" />
          <kbd>⌘K</kbd>
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.slice(0, 10).map((result) => (
                <button key={result.id} type="button" onClick={() => { if (result.provider) setProvider(result.provider); setSessionId(result.sessionId); setSelectedEvent(result); setQuery(""); setSearchResults([]); }}>
                  <span>{result.toolName || result.kind.replaceAll("_", " ")}</span>
                  <small>
                    {(result.snippet || result.text || "")
                      .replaceAll("<mark>", "")
                      .replaceAll("</mark>", "")}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="command-actions">
          <button className="primary-button" type="button" onClick={() => void startScan()} disabled={Boolean(job && ["queued", "running"].includes(job.status))}><Sparkles size={17} />Scan Mac</button>
          <button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}><Import size={17} />Import files</button>
          <input ref={fileRef} hidden type="file" multiple accept=".json,.jsonl,.db,.sqlite,.vscdb" onChange={(event) => void importFiles(event.target.files)} />
          <input ref={folderRef} hidden type="file" multiple accept=".json,.jsonl,.db,.sqlite,.vscdb" {...{ webkitdirectory: "" }} onChange={(event) => void importFiles(event.target.files)} />
          <span className="privacy"><ShieldCheck size={15} />Local only · Nothing leaves this Mac</span>
        </div>
      </header>

      {job && ["queued", "running"].includes(job.status) && (
        <div className="job-strip"><span style={{ width: `${Math.max(job.progress * 100, 2)}%` }} /><p>{job.message || "Indexing…"} · {job.processedFiles}/{job.totalFiles || "?"} files</p><button type="button" onClick={() => void fetch(`/api/jobs/${job.id}`, { method: "DELETE" })}>Cancel</button></div>
      )}
      {error && <div className="error-strip"><CircleError />{error}<button type="button" onClick={() => setError(null)}><X size={15} /></button></div>}

      <div className="workspace">
        <aside className={`left-panel ${sidebarOpen ? "drawer-open" : ""}`}>
          <button className="drawer-close" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
          <section className="source-section">
            <div className="section-title"><h2>Sources</h2><ChevronDown size={17} /></div>
            <nav aria-label="Log sources">
              {overview?.providers.filter((item) => item.id !== "claude-export").map((item) => (
                <button key={item.id} className={provider === item.id ? "active" : ""} type="button" onClick={() => chooseProvider(item.id)}>
                  <ProviderMark provider={item.id} /><span><strong>{item.label}</strong><small>{item.sessionCount.toLocaleString()} sessions{item.diagnosticCount ? ` · ${item.diagnosticCount} warnings` : ""}{item.status === "warning" ? " · Export required" : ""}</small></span>
                </button>
              ))}
            </nav>
          </section>
          <section className="sessions-section">
            <div className="section-title"><h2>Sessions</h2><SlidersHorizontal size={15} /></div>
            <div ref={sessionScroll} className="session-list">
              {sessions.length === 0 ? <div className="session-empty">No sessions indexed for this source.</div> : (
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
                  {virtualizer.getVirtualItems().map((item) => {
                    const value = sessions[item.index];
                    return (
                      <button key={value.id} type="button" className={`session-row ${sessionId === value.id ? "active" : ""} ${value.available ? "" : "unavailable"}`} onClick={() => chooseSession(value)} style={{ transform: `translateY(${item.start}px)` }}>
                        <ProviderMark provider={value.provider} size="small" />
                        <span><strong>{value.projectPath?.split("/").filter(Boolean).at(-1) || value.title}</strong><small>{value.title}{value.diagnosticsCount ? ` · ${value.diagnosticsCount} warnings` : ""}{!value.available ? " · Source unavailable" : ""}</small></span>
                        <time>{sessionTime(value.updatedAt || value.startedAt)}</time>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="main-panel">
          {!session ? (
            <div className="empty-state">
              <div className="empty-icon"><Archive size={25} /></div>
              <h1>{overview?.totalSessions ? "Choose a session" : "Your local AI histories, in one place"}</h1>
              <p>{overview?.totalSessions ? "Select a source and session to inspect its complete event stream." : "Scan this Mac or import a conversation export to explore prompts, reasoning, tools, results, and system events."}</p>
              {!overview?.totalSessions && <div><button className="primary-button" type="button" onClick={() => void startScan()}><Sparkles size={17} />Scan Mac</button><button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}><Import size={17} />Import files</button></div>}
            </div>
          ) : (
            <>
              <header className="session-header">
                <div><h1>{session.projectPath?.split("/").filter(Boolean).at(-1) || session.title} — {session.title}</h1><p><ProviderMark provider={session.provider} size="small" />{overview?.providers.find((item) => item.id === session.provider)?.label} · {formatRelative(session.updatedAt || session.startedAt)} {session.projectPath && <>· <span>{session.projectPath}</span></>}</p></div>
                <button type="button" aria-label="Session actions"><MoreHorizontal size={20} /></button>
              </header>
              <div className="view-tabs"><button className={view === "timeline" ? "active" : ""} type="button" onClick={() => setView("timeline")}>Timeline</button><button className={view === "conversation" ? "active" : ""} type="button" onClick={() => setView("conversation")}>Conversation</button></div>
              <div className="filter-bar">{filterGroups.map((group) => <button key={group.id} className={filter === group.id ? "active" : ""} type="button" onClick={() => setFilter(group.id)}>{group.label}</button>)}</div>
              <div className="timeline">
                {events.length ? events.map((value) => <EventCard key={value.id} event={value} selected={selectedEvent?.id === value.id} onSelect={() => chooseEvent(value)} />) : <div className="no-events">No events match this filter.</div>}
              </div>
            </>
          )}
        </section>

        <div className={`inspector-wrap ${inspectorOpen ? "drawer-open" : ""}`}><EventInspector event={selectedEvent} relatedEvent={selectedEvent?.callId ? events.find((item) => item.id !== selectedEvent.id && item.callId === selectedEvent.callId) : null} source={overview?.providers.find((item) => item.id === session?.provider)?.label} tab={inspectorTab} onTab={setInspectorTab} onClose={() => setInspectorOpen(false)} onRelated={() => { const related = selectedEvent?.callId ? events.find((item) => item.id !== selectedEvent.id && item.callId === selectedEvent.callId) : null; if (related) chooseEvent(related); }} /></div>
      </div>

      <footer className="status-bar">
        <span><CheckCircle2 size={15} />{overview?.totalSessions.toLocaleString() || 0} sessions indexed · Last scan {formatRelative(overview?.lastScanAt)}</span>
        <span><button type="button" onClick={() => setSettingsOpen(true)}><FolderOpen size={15} />Open data details</button><i /><button type="button" onClick={() => setSettingsOpen(true)}><Settings size={15} />Settings</button></span>
      </footer>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><h2 id="settings-title">Local index settings</h2><button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
            <p>The index is stored in <code>.data/ailogexplorer.sqlite</code>. AI Log Explorer only reads source histories and never sends their contents over the network.</p>
            <ul>{overview?.providers.map((item) => <li key={item.id}><ProviderMark provider={item.id} size="small" /><span><strong>{item.label}</strong><small>{item.note || `${item.eventCount.toLocaleString()} events indexed`}</small></span></li>)}</ul>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => folderRef.current?.click()}>Import export folder</button><button className="secondary-button" type="button" onClick={() => void startScan()}>Rebuild changed files</button><button className="danger-button" type="button" onClick={async () => { if (!window.confirm("Clear the entire local AI Log Explorer index? Source logs will not be changed.")) return; await fetchJson("/api/index", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "CLEAR LOCAL INDEX" }) }); setSettingsOpen(false); setSessionId(null); await refreshOverview(); }}>Clear local index</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

function CircleError() {
  return <span aria-hidden="true" className="error-dot">!</span>;
}


