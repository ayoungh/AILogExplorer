import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { EVENT_PAGE_SIZE } from "@/lib/explorer-config";
import type {
  AnalyticsResponse,
  DataConceptId,
  DataMapResponse,
  DataMapSampleResponse,
  EventContentPart,
  EventContentPreview,
  EventKind,
  EventPageResponse,
  EventSummary,
  JobRecord,
  NormalizedSession,
  OverviewResponse,
  ProviderId,
  RecentFilesResponse,
  SearchResponse,
  SearchSort,
  SessionMetrics,
} from "@/lib/types";

export type EventPageParam = { offset: number; anchor: string | null };
export type SearchFilters = {
  providers?: ProviderId[];
  projects?: string[];
  models?: string[];
  kinds?: EventKind[];
  sessionId?: string;
  from?: string;
  to?: string;
  sort?: SearchSort;
};

export type AnalyticsFilters = {
  from: string;
  to: string;
  timezone: string;
  providers?: ProviderId[];
  projects?: string[];
  models?: string[];
};

export const queryKeys = {
  overview: ["overview"] as const,
  sessions: (provider: ProviderId) => ["sessions", provider] as const,
  events: (sessionId: string, kinds: EventKind[], anchor: string | null) => ["events", sessionId, kinds.join(","), anchor || ""] as const,
  eventContent: (eventId: string, part: EventContentPart) => ["event-content", eventId, part] as const,
  search: (query: string, filters: SearchFilters = {}) => ["search", query, filters] as const,
  sessionMetrics: (sessionId: string) => ["session-metrics", sessionId] as const,
  analytics: (filters: AnalyticsFilters) => ["analytics", filters] as const,
  recentFiles: (filters: Pick<AnalyticsFilters, "from" | "to" | "providers" | "projects">) => ["recent-files", filters] as const,
  settings: ["settings"] as const,
  job: (id: string) => ["job", id] as const,
  dataMap: ["data-map"] as const,
  dataMapSample: (provider: ProviderId, concept: DataConceptId, index: number) => ["data-map-sample", provider, concept, index] as const,
};

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function overviewQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.overview,
    queryFn: ({ signal }) => requestJson<OverviewResponse>("/api/overview", { signal }),
  });
}

export function sessionsQueryOptions(provider: ProviderId) {
  return queryOptions({
    queryKey: queryKeys.sessions(provider),
    queryFn: ({ signal }) => requestJson<{ data: NormalizedSession[] }>(`/api/sessions?provider=${provider}&limit=250`, { signal }),
  });
}

export function eventPagesQueryOptions(sessionId: string, kinds: EventKind[], anchor: string | null) {
  return infiniteQueryOptions({
    queryKey: queryKeys.events(sessionId, kinds, anchor),
    initialPageParam: { offset: 0, anchor } satisfies EventPageParam,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ mode: "summary", limit: String(EVENT_PAGE_SIZE), offset: String(pageParam.offset) });
      for (const kind of kinds) params.append("kind", kind);
      if (pageParam.anchor) params.set("anchor", pageParam.anchor);
      return requestJson<EventPageResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/events?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextOffset == null ? undefined : { offset: page.nextOffset, anchor: null },
    getPreviousPageParam: (page) => page.previousOffset == null ? undefined : { offset: page.previousOffset, anchor: null },
  });
}

export function eventContentQueryOptions(eventId: string, part: EventContentPart) {
  return queryOptions({
    queryKey: queryKeys.eventContent(eventId, part),
    queryFn: ({ signal }) => requestJson<EventContentPreview>(`/api/events/${encodeURIComponent(eventId)}?part=${part}`, { signal }),
    staleTime: 5 * 60_000,
  });
}

function appendValues(params: URLSearchParams, key: string, values?: readonly string[]) {
  for (const value of values || []) params.append(key, value);
}

function searchParams(query: string, filters: SearchFilters, limit: number, offset: number) {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset), sort: filters.sort || "relevance" });
  appendValues(params, "provider", filters.providers);
  appendValues(params, "project", filters.projects);
  appendValues(params, "model", filters.models);
  appendValues(params, "kind", filters.kinds);
  if (filters.sessionId) params.set("session", filters.sessionId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export function searchQueryOptions(query: string, filters: SearchFilters = {}, limit = 80, offset = 0) {
  return queryOptions({
    queryKey: [...queryKeys.search(query, filters), limit, offset] as const,
    queryFn: ({ signal }) => requestJson<SearchResponse>(`/api/search?${searchParams(query, filters, limit, offset)}`, { signal }),
    enabled: query.length >= 2,
  });
}

export function searchPagesQueryOptions(query: string, filters: SearchFilters = {}, limit = 40) {
  return infiniteQueryOptions({
    queryKey: queryKeys.search(query, filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => requestJson<SearchResponse>(`/api/search?${searchParams(query, filters, limit, pageParam)}`, { signal }),
    getNextPageParam: (page) => page.nextOffset == null ? undefined : page.nextOffset,
  });
}

export function sessionMetricsQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.sessionMetrics(sessionId),
    queryFn: ({ signal }) => requestJson<SessionMetrics>(`/api/sessions/${encodeURIComponent(sessionId)}/metrics`, { signal }),
    enabled: Boolean(sessionId),
  });
}

export function analyticsQueryOptions(filters: AnalyticsFilters) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, timezone: filters.timezone });
  appendValues(params, "provider", filters.providers);
  appendValues(params, "project", filters.projects);
  appendValues(params, "model", filters.models);
  return queryOptions({
    queryKey: queryKeys.analytics(filters),
    queryFn: ({ signal }) => requestJson<AnalyticsResponse>(`/api/analytics?${params}`, { signal }),
  });
}

export function recentFilesQueryOptions(filters: Pick<AnalyticsFilters, "from" | "to" | "providers" | "projects">) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, limit: "100" });
  appendValues(params, "provider", filters.providers);
  appendValues(params, "project", filters.projects);
  return queryOptions({
    queryKey: queryKeys.recentFiles(filters),
    queryFn: ({ signal }) => requestJson<RecentFilesResponse>(`/api/recent-files?${params}`, { signal }),
  });
}

export function jobQueryOptions(id: string) {
  return queryOptions({
    queryKey: queryKeys.job(id),
    queryFn: ({ signal }) => requestJson<JobRecord>(`/api/jobs/${encodeURIComponent(id)}`, { signal }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !["queued", "running"].includes(status) ? false : 750;
    },
  });
}

export function dataMapQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.dataMap,
    queryFn: ({ signal }) => requestJson<DataMapResponse>("/api/data-map", { signal }),
  });
}

export function dataMapSampleQueryOptions(provider: ProviderId, concept: DataConceptId, index: number) {
  return queryOptions({
    queryKey: queryKeys.dataMapSample(provider, concept, index),
    queryFn: ({ signal }) => requestJson<DataMapSampleResponse>(`/api/data-map/sample?provider=${provider}&concept=${concept}&index=${index}`, { signal }),
  });
}

export function flattenEventPages(pages: EventPageResponse[] | undefined) {
  if (!pages) return [];
  const byId = new Map<string, EventSummary>();
  for (const page of pages) for (const event of page.data) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

export function reconcileSelectedEvent(events: EventSummary[], currentId: string | null, anchorId: string | null) {
  if (!events.length) return null;
  if (currentId && events.some((event) => event.id === currentId)) return currentId;
  return events.find((event) => event.id === anchorId)?.id || events[0].id;
}

export async function invalidateExplorerData(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["events"] });
  queryClient.removeQueries({ queryKey: ["event-content"] });
  queryClient.removeQueries({ queryKey: ["search"] });
  queryClient.removeQueries({ queryKey: ["session-metrics"] });
  queryClient.removeQueries({ queryKey: ["data-map-sample"] });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
    queryClient.invalidateQueries({ queryKey: ["sessions"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dataMap }),
    queryClient.invalidateQueries({ queryKey: ["analytics"] }),
    queryClient.invalidateQueries({ queryKey: ["recent-files"] }),
  ]);
}
