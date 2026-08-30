import { NextRequest, NextResponse } from "next/server";
import { EVENT_KINDS, PROVIDER_IDS, type EventKind, type ProviderId, type SearchSort } from "@/lib/types";
import { searchEvents } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim() || "";
  if (query.length < 2) return NextResponse.json({ data: [], total: 0, nextOffset: null, facets: { providers: [], projects: [], models: [], kinds: [] } });
  const providerValues = params.getAll("provider");
  const kindValues = params.getAll("kind");
  if (providerValues.some((value) => !PROVIDER_IDS.includes(value as ProviderId)) || kindValues.some((value) => !EVENT_KINDS.includes(value as EventKind))) {
    return NextResponse.json({ error: "Invalid search filter" }, { status: 400 });
  }
  const providers = providerValues as ProviderId[];
  const kinds = kindValues as EventKind[];
  const sortValue = params.get("sort");
  if (sortValue && !["relevance", "recent", "sequence"].includes(sortValue)) return NextResponse.json({ error: "Invalid sort" }, { status: 400 });
  const sort: SearchSort = ["relevance", "recent", "sequence"].includes(sortValue || "") ? sortValue as SearchSort : "relevance";
  const limit = boundedInteger(params.get("limit"), 80, 1, 100);
  const offset = boundedInteger(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const from = validDate(params.get("from"));
  const to = validDate(params.get("to"));
  if ((params.has("from") && !from) || (params.has("to") && !to) || (from && to && from >= to)) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  try {
    return NextResponse.json(searchEvents({ query, providers, projects: params.getAll("project"), models: params.getAll("model"),
      kinds, sessionId: params.get("session") || undefined, from: from || undefined, to: to || undefined, sort, limit, offset }));
  }
  catch { return NextResponse.json({ error: "Search failed" }, { status: 500 }); }
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}

function validDate(value: string | null) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
