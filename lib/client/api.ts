import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { EVENT_PAGE_SIZE } from "@/lib/explorer-config";
import type {
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
} from "@/lib/types";

export type EventPageParam = { offset: number; anchor: string | null };
export type SearchEvent = EventSummary & { snippet?: string; provider?: ProviderId };

export const queryKeys = {
  overview: ["overview"] as const,
  sessions: (provider: ProviderId) => ["sessions", provider] as const,
  events: (sessionId: string, kinds: EventKind[], anchor: string | null) => ["events", sessionId, kinds.join(","), anchor || ""] as const,
  eventContent: (eventId: string, part: EventContentPart) => ["event-content", eventId, part] as const,
  search: (query: string) => ["search", query] as const,
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

export function searchQueryOptions(query: string) {
  return queryOptions({
    queryKey: queryKeys.search(query),
    queryFn: ({ signal }) => requestJson<{ data: SearchEvent[] }>(`/api/search?q=${encodeURIComponent(query)}`, { signal }),
    enabled: query.length >= 2,
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
  queryClient.removeQueries({ queryKey: ["data-map-sample"] });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
    queryClient.invalidateQueries({ queryKey: ["sessions"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dataMap }),
  ]);
}
