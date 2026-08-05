import { NextRequest, NextResponse } from "next/server";
import { EVENT_KINDS, type EventKind } from "@/lib/types";
import { getSession, listEventPage, listEvents } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const values = request.nextUrl.searchParams.getAll("kind").filter((kind): kind is EventKind => EVENT_KINDS.includes(kind as EventKind));
  if (request.nextUrl.searchParams.get("mode") === "summary") {
    const page = listEventPage({
      sessionId: id,
      kinds: values,
      limit: boundedInteger(request.nextUrl.searchParams.get("limit"), 200, 1, 200),
      offset: boundedInteger(request.nextUrl.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER),
      anchorEventId: request.nextUrl.searchParams.get("anchor") || undefined,
    });
    return NextResponse.json({ session, ...page });
  }
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 500), 1000);
  const offset = Math.max(Number(request.nextUrl.searchParams.get("offset") || 0), 0);
  const data = listEvents(id, values, limit, offset);
  return NextResponse.json({ session, data, nextOffset: data.length === limit ? offset + limit : null });
}

