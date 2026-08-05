"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, CheckCircle2, ChevronDown, FileJson2, FolderOpen, Import, Menu, MoreHorizontal, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  eventPagesQueryOptions,
  flattenEventPages,
  invalidateExplorerData,
  jobQueryOptions,
  overviewQueryOptions,
  queryKeys,
  reconcileSelectedEvent,
  requestJson,
  searchQueryOptions,
  sessionsQueryOptions,
} from "@/lib/client/api";
import { CONVERSATION_KINDS, eventKindsForFilter, FILTER_GROUPS } from "@/lib/explorer-config";
import { DATA_CONCEPT_IDS, type DataConceptId, type EventSummary, type JobRecord, type NormalizedSession, type ProviderId } from "@/lib/types";
import { AppModeSwitch } from "./app-mode-switch";
import { EventCard } from "./event-card";
import { ProviderMark } from "./provider-mark";

const DataMap = dynamic(() => import("./data-map").then((module) => module.DataMap));
const EventInspector = dynamic(() => import("./event-inspector").then((module) => module.EventInspector));

function formatRelative(value: string | null | undefined) {
  if (!value) return "Never";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

function sessionTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 5) : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function isActiveJob(job: JobRecord | null | undefined) {
  return Boolean(job && ["queued", "running"].includes(job.status));
}

export function Explorer({ initialParams = "", initialProvider, initialSessionId }: {
  initialParams?: string;
  initialProvider: ProviderId;
  initialSessionId: string | null;
}) {
  const params = useRef(new URLSearchParams(initialParams)).current;
  const requestedConcept = params.get("concept") as DataConceptId;
  const queryClient = useQueryClient();
  const [isNavigating, startTransition] = useTransition();
  const [mode, setMode] = useState<"logs" | "data-map">(params.get("mode") === "data-map" ? "data-map" : "logs");
  const [conceptId, setConceptId] = useState<DataConceptId>(DATA_CONCEPT_IDS.includes(requestedConcept) ? requestedConcept : "messages");
  const [sampleIndex, setSampleIndex] = useState(Math.max(0, Number(params.get("sample") || 0) || 0));
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [eventAnchorId, setEventAnchorId] = useState(params.get("event"));
  const [selectedEventId, setSelectedEventId] = useState(params.get("event"));
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [view, setView] = useState<"timeline" | "conversation">((params.get("view") as "timeline" | "conversation") || "timeline");
  const [inspectorTab, setInspectorTab] = useState<"normalized" | "raw">("normalized");
  const [query, setQuery] = useState(params.get("search") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sessionScroll = useRef<HTMLDivElement>(null);
  const timelineScroll = useRef<HTMLDivElement>(null);
  const prependPosition = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const scrolledAnchor = useRef<string | null>(null);
  const completedJobs = useRef(new Set<string>());
  const jobWaiters = useRef(new Map<string, (job: JobRecord) => void>());

  const overviewQuery = useQuery(overviewQueryOptions());
  const overview = overviewQuery.data;
  const sessionsQuery = useQuery({ ...sessionsQueryOptions(provider), enabled: mode === "logs" });
  const sessions = useMemo(() => sessionsQuery.data?.data || [], [sessionsQuery.data]);
  const activeKinds = useMemo(() => eventKindsForFilter(filter), [filter]);
  const eventPagesQuery = useInfiniteQuery({
    ...eventPagesQueryOptions(sessionId || "", activeKinds, eventAnchorId),
    enabled: mode === "logs" && Boolean(sessionId),
  });
  const events = useMemo(() => flattenEventPages(eventPagesQuery.data?.pages), [eventPagesQuery.data?.pages]);
  const visibleEvents = useMemo(
    () => view === "conversation" ? events.filter((event) => CONVERSATION_KINDS.includes(event.kind)) : events,
    [events, view],
  );
  const session = eventPagesQuery.data?.pages[0]?.session || sessions.find((value) => value.id === sessionId) || null;
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId) || null;
  const relatedEvent = selectedEvent?.callId
    ? visibleEvents.find((event) => event.id !== selectedEvent.id && event.callId === selectedEvent.callId) || null
    : null;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery(searchQueryOptions(debouncedQuery));
  const searchResults = query.trim().length >= 2 && query.trim() === debouncedQuery ? searchQuery.data?.data || [] : [];

  useEffect(() => {
    if (!sessionsQuery.data) return;
    if (!sessionId || !sessions.some((value) => value.id === sessionId)) {
      setSessionId(sessions[0]?.id || null);
      setSelectedEventId(null);
      setEventAnchorId(null);
    }
  }, [sessionId, sessions, sessionsQuery.data]);

  useEffect(() => {
    setSelectedEventId((current) => reconcileSelectedEvent(visibleEvents, current, eventAnchorId));
  }, [eventAnchorId, visibleEvents]);

  useEffect(() => {
    scrolledAnchor.current = null;
    if (!eventAnchorId && timelineScroll.current) timelineScroll.current.scrollTop = 0;
  }, [eventAnchorId, filter, sessionId]);

  useEffect(() => {
    const active = overview?.activeJob;
    if (active && !completedJobs.current.has(active.id)) setActiveJobId((current) => current || active.id);
  }, [overview?.activeJob]);

  const jobId = activeJobId || "";
  const jobQuery = useQuery({ ...jobQueryOptions(jobId), enabled: Boolean(jobId) });
  const job = activeJobId ? jobQuery.data || (overview?.activeJob?.id === activeJobId ? overview.activeJob : null) : null;

  useEffect(() => {
    if (!job || isActiveJob(job) || completedJobs.current.has(job.id)) return;
    completedJobs.current.add(job.id);
    jobWaiters.current.get(job.id)?.(job);
    jobWaiters.current.delete(job.id);
    void invalidateExplorerData(queryClient).finally(() => setActiveJobId((current) => current === job.id ? null : current));
  }, [job, queryClient]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const values: Record<string, string | null> = mode === "data-map"
      ? { mode: "data-map", concept: conceptId, provider, sample: String(sampleIndex), session: null, event: null, filter: null, view: null, search: query.trim() || null }
      : { mode: null, concept: null, sample: null, provider, session: sessionId, event: selectedEventId, filter, view, search: query.trim() || null };
    Object.entries(values).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    window.history.replaceState({}, "", url);
  }, [mode, conceptId, sampleIndex, provider, sessionId, selectedEventId, filter, view, query]);

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

  // TanStack Virtual intentionally exposes mutable measurement helpers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const sessionVirtualizer = useVirtualizer({ count: sessions.length, getScrollElement: () => sessionScroll.current, estimateSize: () => 64, overscan: 8 });
  const eventVirtualizer = useVirtualizer({
    count: visibleEvents.length,
    getScrollElement: () => timelineScroll.current,
    estimateSize: () => 132,
    overscan: 8,
    getItemKey: (index) => visibleEvents[index]?.id || index,
  });
  const virtualEvents = eventVirtualizer.getVirtualItems();

  const fetchPreviousPage = useCallback(async () => {
    const element = timelineScroll.current;
    if (!element || eventPagesQuery.isFetchingPreviousPage || !eventPagesQuery.hasPreviousPage) return;
    prependPosition.current = { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    await eventPagesQuery.fetchPreviousPage();
    requestAnimationFrame(() => {
      const marker = prependPosition.current;
      if (marker && timelineScroll.current) timelineScroll.current.scrollTop = marker.scrollTop + Math.max(timelineScroll.current.scrollHeight - marker.scrollHeight, 0);
      prependPosition.current = null;
    });
  }, [eventPagesQuery]);

  useEffect(() => {
    if (!virtualEvents.length) return;
    const first = virtualEvents[0];
    const last = virtualEvents[virtualEvents.length - 1];
    if (last.index >= visibleEvents.length - 12 && eventPagesQuery.hasNextPage && !eventPagesQuery.isFetchingNextPage) void eventPagesQuery.fetchNextPage();
    const anchorReady = !eventAnchorId || scrolledAnchor.current === `${sessionId}:${eventAnchorId}`;
    if (anchorReady && first.index <= 12 && eventPagesQuery.hasPreviousPage && !eventPagesQuery.isFetchingPreviousPage) void fetchPreviousPage();
  }, [eventAnchorId, eventPagesQuery, fetchPreviousPage, sessionId, virtualEvents, visibleEvents.length]);

  useEffect(() => {
    if (!eventAnchorId || scrolledAnchor.current === `${sessionId}:${eventAnchorId}`) return;
    const index = visibleEvents.findIndex((event) => event.id === eventAnchorId);
    if (index < 0) return;
    eventVirtualizer.scrollToIndex(index, { align: "center" });
    scrolledAnchor.current = `${sessionId}:${eventAnchorId}`;
  }, [eventAnchorId, eventVirtualizer, sessionId, visibleEvents]);

  const scanMutation = useMutation({
    mutationFn: () => requestJson<JobRecord>("/api/jobs/scan", { method: "POST" }),
    onSuccess: (created) => { queryClient.setQueryData(queryKeys.job(created.id), created); setActiveJobId(created.id); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Scan failed"),
  });
  const importMutation = useMutation({
    mutationFn: (file: File) => requestJson<JobRecord>("/api/jobs/import", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    }),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => requestJson<JobRecord>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.job(next.id), next),
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Could not cancel the job"),
  });
  const clearMutation = useMutation({
    mutationFn: () => requestJson<{ ok: true }>("/api/index", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "CLEAR LOCAL INDEX" }) }),
    onSuccess: () => {
      queryClient.removeQueries();
      setSessionId(null);
      setSelectedEventId(null);
      setEventAnchorId(null);
      setSettingsOpen(false);
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Could not clear the local index"),
  });

  const waitForJob = useCallback((id: string) => {
    const cached = queryClient.getQueryData<JobRecord>(queryKeys.job(id));
    if (cached && !isActiveJob(cached)) return Promise.resolve(cached);
    return new Promise<JobRecord>((resolve) => jobWaiters.current.set(id, resolve));
  }, [queryClient]);

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const created = await importMutation.mutateAsync(file);
        queryClient.setQueryData(queryKeys.job(created.id), created);
        setActiveJobId(created.id);
        await waitForJob(created.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `Could not import ${file.name}`);
        break;
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  };

  const chooseProvider = useCallback((value: ProviderId) => {
    setProvider(value);
    setSessionId(null);
    setSelectedEventId(null);
    setEventAnchorId(null);
    setSidebarOpen(false);
  }, []);
  const chooseSession = useCallback((value: NormalizedSession) => {
    setSessionId(value.id);
    setSelectedEventId(null);
    setEventAnchorId(null);
    setSidebarOpen(false);
  }, []);
  const chooseEvent = useCallback((value: EventSummary) => { setSelectedEventId(value.id); setInspectorOpen(true); }, []);
  const chooseDataProvider = useCallback((value: ProviderId) => setProvider(value), []);
  const chooseConcept = useCallback((value: DataConceptId) => setConceptId(value), []);
  const chooseSample = useCallback((value: number) => setSampleIndex(value), []);
  const switchMode = useCallback((value: "logs" | "data-map") => { setMode(value); setSidebarOpen(false); setInspectorOpen(false); }, []);
  const chooseFilter = (value: string) => startTransition(() => { setFilter(value); setSelectedEventId(null); setEventAnchorId(null); });
  const chooseView = (value: "timeline" | "conversation") => startTransition(() => setView(value));
  const queryError = overviewQuery.error || sessionsQuery.error || eventPagesQuery.error;
  const visibleFilterGroups = view === "conversation" ? FILTER_GROUPS.filter((group) => ["all", "messages", "tools"].includes(group.id)) : FILTER_GROUPS;

  return (
    <main className="app-frame">
      <header className="command-bar">
        <button className="mobile-menu" type="button" aria-label={mode === "data-map" ? "Open data concepts" : "Open sources and sessions"} onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
        <div className="wordmark"><FileJson2 size={25} strokeWidth={1.7} /><span>AI Log Explorer</span></div>
        <div className="search-shell">
          <Search size={17} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts, tools, paths…" aria-label="Search all indexed events" />
          <kbd>⌘K</kbd>
          {searchResults.length ? (
            <div className="search-results">
              {searchResults.slice(0, 10).map((result) => (
                <button key={result.id} type="button" onClick={() => {
                  setMode("logs");
                  if (result.provider) setProvider(result.provider);
                  setFilter("all");
                  setView("timeline");
                  setSessionId(result.sessionId);
                  setEventAnchorId(result.id);
                  setSelectedEventId(result.id);
                  setInspectorOpen(true);
                  setQuery("");
                  setDebouncedQuery("");
                }}>
                  <span>{result.toolName || result.kind.replaceAll("_", " ")}</span>
                  <small>{(result.snippet || result.text || "").replaceAll("<mark>", "").replaceAll("</mark>", "")}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="command-actions">
          <button className="primary-button" type="button" onClick={() => { setError(null); scanMutation.mutate(); }} disabled={isActiveJob(job) || scanMutation.isPending}><Sparkles size={17} />Scan Mac</button>
          <button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}><Import size={17} />Import files</button>
          <input ref={fileRef} hidden type="file" multiple accept=".json,.jsonl,.db,.sqlite,.vscdb" onChange={(event) => void importFiles(event.target.files)} />
          <input ref={folderRef} hidden type="file" multiple accept=".json,.jsonl,.db,.sqlite,.vscdb" {...{ webkitdirectory: "" }} onChange={(event) => void importFiles(event.target.files)} />
          <span className="privacy"><ShieldCheck size={15} />Local only · Nothing leaves this Mac</span>
        </div>
      </header>

      {job && isActiveJob(job) ? (
        <div className="job-strip"><span style={{ width: `${Math.max(job.progress * 100, 2)}%` }} /><p>{job.message || "Indexing…"} · {job.processedFiles}/{job.totalFiles || "?"} files</p><button type="button" onClick={() => cancelMutation.mutate(job.id)}>Cancel</button></div>
      ) : null}
      {error ? <div className="error-strip"><CircleError />{error}<button type="button" onClick={() => setError(null)}><X size={15} /></button></div> : null}
      {!error && queryError ? <div className="error-strip"><CircleError />{queryError.message}<button type="button" onClick={() => { void overviewQuery.refetch(); void sessionsQuery.refetch(); void eventPagesQuery.refetch(); }}>Retry</button></div> : null}

      {mode === "data-map" ? (
        <DataMap conceptId={conceptId} provider={provider} sampleIndex={sampleIndex} sidebarOpen={sidebarOpen} inspectorOpen={inspectorOpen} onMode={switchMode} onConcept={chooseConcept} onProvider={chooseDataProvider} onSample={chooseSample} onSidebarClose={() => setSidebarOpen(false)} onInspectorOpen={() => setInspectorOpen(true)} onInspectorClose={() => setInspectorOpen(false)} />
      ) : (
        <div className="workspace">
          <aside className={`left-panel ${sidebarOpen ? "drawer-open" : ""}`}>
            <button className="drawer-close" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
            <AppModeSwitch mode="logs" onChange={switchMode} />
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
                {!sessions.length ? <div className="session-empty">{sessionsQuery.isPending ? "Loading sessions…" : "No sessions indexed for this source."}</div> : (
                  <div style={{ height: `${sessionVirtualizer.getTotalSize()}px`, position: "relative" }}>
                    {sessionVirtualizer.getVirtualItems().map((item) => {
                      const value = sessions[item.index];
                      return (
                        <button key={value.id} type="button" className={`session-row ${sessionId === value.id ? "active" : ""} ${value.available ? "" : "unavailable"}`} onClick={() => chooseSession(value)} style={{ transform: `translateY(${item.start}px)` }}>
                          <ProviderMark provider={value.provider} size="small" />
                          <span><strong>{value.projectPath?.split("/").filter(Boolean).at(-1) || value.title}</strong><small>{value.title}{value.diagnosticsCount ? ` · ${value.diagnosticsCount} warnings` : ""}{!value.available ? " · Source unavailable" : ""}</small></span>
                          <time suppressHydrationWarning>{sessionTime(value.updatedAt || value.startedAt)}</time>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </aside>

          <section className="main-panel" aria-busy={isNavigating || eventPagesQuery.isPending}>
            {!session ? (
              <div className="empty-state">
                <div className="empty-icon"><Archive size={25} /></div>
                <h1>{overview?.totalSessions ? "Choose a session" : "Your local AI histories, in one place"}</h1>
                <p>{overview?.totalSessions ? "Select a source and session to inspect its complete event stream." : "Scan this Mac or import a conversation export to explore prompts, reasoning, tools, results, and system events."}</p>
                {!overview?.totalSessions ? <div><button className="primary-button" type="button" onClick={() => scanMutation.mutate()}><Sparkles size={17} />Scan Mac</button><button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}><Import size={17} />Import files</button></div> : null}
              </div>
            ) : (
              <>
                <header className="session-header">
                  <div><h1>{session.projectPath?.split("/").filter(Boolean).at(-1) || session.title} — {session.title}</h1><p suppressHydrationWarning><ProviderMark provider={session.provider} size="small" />{overview?.providers.find((item) => item.id === session.provider)?.label} · {formatRelative(session.updatedAt || session.startedAt)} {session.projectPath ? <>· <span>{session.projectPath}</span></> : null}</p></div>
                  <button type="button" aria-label="Session actions"><MoreHorizontal size={20} /></button>
                </header>
                <div className="view-tabs"><button className={view === "timeline" ? "active" : ""} type="button" onClick={() => chooseView("timeline")}>Timeline</button><button className={view === "conversation" ? "active" : ""} type="button" onClick={() => chooseView("conversation")}>Conversation</button></div>
                <div className="filter-bar">{visibleFilterGroups.map((group) => <button key={group.id} className={filter === group.id ? "active" : ""} type="button" onClick={() => chooseFilter(group.id)}>{group.label}</button>)}<span className="event-count">{visibleEvents.length.toLocaleString()} of {eventPagesQuery.data?.pages[0]?.total.toLocaleString() || 0}</span></div>
                <div ref={timelineScroll} className="timeline">
                  {eventPagesQuery.isFetchingPreviousPage ? <span className="timeline-page-status timeline-page-top">Loading earlier events…</span> : null}
                  {visibleEvents.length ? (
                    <div className="timeline-window" style={{ height: `${eventVirtualizer.getTotalSize()}px` }}>
                      {virtualEvents.map((item) => {
                        const value = visibleEvents[item.index];
                        return (
                          <div key={value.id} className="virtual-event-row" data-index={item.index} ref={eventVirtualizer.measureElement} style={{ transform: `translateY(${item.start}px)` }}>
                            <EventCard event={value} provider={session.provider} selected={selectedEventId === value.id} onSelect={chooseEvent} />
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="no-events">{eventPagesQuery.isPending ? "Loading events…" : "No events match this filter."}</div>}
                  {eventPagesQuery.isFetchingNextPage ? <span className="timeline-page-status timeline-page-bottom">Loading more events…</span> : null}
                </div>
              </>
            )}
          </section>

          <div className={`inspector-wrap ${inspectorOpen ? "drawer-open" : ""}`}>
            <EventInspector event={selectedEvent} relatedEvent={relatedEvent} source={overview?.providers.find((item) => item.id === session?.provider)?.label} tab={inspectorTab} onTab={setInspectorTab} onClose={() => setInspectorOpen(false)} onRelated={() => { if (relatedEvent) chooseEvent(relatedEvent); }} />
          </div>
        </div>
      )}

      <footer className="status-bar">
        <span suppressHydrationWarning><CheckCircle2 size={15} />{overview?.totalSessions.toLocaleString() || 0} sessions indexed · Last scan {formatRelative(overview?.lastScanAt)}</span>
        <span><button type="button" onClick={() => setSettingsOpen(true)}><FolderOpen size={15} />Open data details</button><i /><button type="button" onClick={() => setSettingsOpen(true)}><Settings size={15} />Settings</button></span>
      </footer>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><h2 id="settings-title">Local index settings</h2><button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
            <p>The index is stored in <code>.data/ailogexplorer.sqlite</code>. AI Log Explorer only reads source histories and never sends their contents over the network.</p>
            <ul>{overview?.providers.map((item) => <li key={item.id}><ProviderMark provider={item.id} size="small" /><span><strong>{item.label}</strong><small>{item.note || `${item.eventCount.toLocaleString()} events indexed`}</small></span></li>)}</ul>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => folderRef.current?.click()}>Import export folder</button><button className="secondary-button" type="button" onClick={() => scanMutation.mutate()}>Rebuild changed files</button><button className="danger-button" type="button" onClick={() => { if (window.confirm("Clear the entire local AI Log Explorer index? Source logs will not be changed.")) clearMutation.mutate(); }}>Clear local index</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function CircleError() {
  return <span aria-hidden="true" className="error-dot">!</span>;
}
