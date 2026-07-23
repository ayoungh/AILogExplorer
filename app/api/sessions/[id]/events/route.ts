import { NextRequest, NextResponse } from "next/server";
import { EVENT_KINDS, type EventKind } from "@/lib/types";
import { getSession, listEvents } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const values = request.nextUrl.searchParams.getAll("kind").filter((kind): kind is EventKind => EVENT_KINDS.includes(kind as EventKind));
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 500), 1000);
  const offset = Math.max(Number(request.nextUrl.searchParams.get("offset") || 0), 0);
  const data = listEvents(id, values, limit, offset);
  return NextResponse.json({ session, data, nextOffset: data.length === limit ? offset + limit : null });
}


