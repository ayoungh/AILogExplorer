import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Explorer } from "@/components/explorer";
import { eventKindsForFilter, EVENT_PAGE_SIZE } from "@/lib/explorer-config";
import { queryKeys, type EventPageParam } from "@/lib/client/api";
import { makeQueryClient } from "@/lib/query-client";
import { recoverOrphanedJobs } from "@/lib/server/jobs";
import { getSession, listEventPage, listSessions, overview } from "@/lib/server/repository";
import { PROVIDER_IDS, type EventPageResponse, type OverviewResponse, type ProviderId } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  const queryClient = makeQueryClient();
  recoverOrphanedJobs();
  const overviewValue = overview();
  const overviewResponse: OverviewResponse = {
    ...overviewValue,
    encryptedChatGptCache: overviewValue.providers.some((provider) => provider.id === "chatgpt" && provider.status === "warning"),
  };
  queryClient.setQueryData(queryKeys.overview, overviewResponse);

  const requestedProvider = params.get("provider");
  const provider = PROVIDER_IDS.includes(requestedProvider as ProviderId)
    ? requestedProvider as ProviderId
    : overviewResponse.providers.find((item) => item.sessionCount > 0)?.id || overviewResponse.providers[0]?.id || "claude-code";
  const logsMode = params.get("mode") !== "data-map";
  const sessionData = logsMode ? listSessions({ provider, limit: 250 }) : [];
  if (logsMode) queryClient.setQueryData(queryKeys.sessions(provider), { data: sessionData });

  const requestedSession = params.get("session");
  const requestedSessionValue = requestedSession ? getSession(requestedSession) : null;
  const sessionId = logsMode
    ? requestedSessionValue?.provider === provider && sessionData.some((session) => session.id === requestedSession)
      ? requestedSession
      : sessionData[0]?.id || null
    : null;

  if (logsMode && sessionId) {
    const kinds = eventKindsForFilter(params.get("filter") || "all");
    const anchor = params.get("event");
    await queryClient.prefetchInfiniteQuery({
      queryKey: queryKeys.events(sessionId, kinds, anchor),
      initialPageParam: { offset: 0, anchor } satisfies EventPageParam,
      queryFn: ({ pageParam }) => ({
        session: getSession(sessionId)!,
        ...listEventPage({
          sessionId,
          kinds,
          limit: EVENT_PAGE_SIZE,
          offset: pageParam.offset,
          anchorEventId: pageParam.anchor || undefined,
        }),
      }) satisfies EventPageResponse,
      getNextPageParam: (page: EventPageResponse) => page.nextOffset == null ? undefined : { offset: page.nextOffset, anchor: null },
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Explorer initialParams={params.toString()} initialProvider={provider} initialSessionId={sessionId} />
    </HydrationBoundary>
  );
}
