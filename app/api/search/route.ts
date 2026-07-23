import { NextRequest, NextResponse } from "next/server";
import { PROVIDER_IDS, type ProviderId } from "@/lib/types";
import { searchEvents } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 2) return NextResponse.json({ data: [] });
  const value = request.nextUrl.searchParams.get("provider");
  const provider = PROVIDER_IDS.includes(value as ProviderId) ? value as ProviderId : undefined;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") || 80), 1), 100);
  const offset = Math.max(Number(request.nextUrl.searchParams.get("offset") || 0), 0);
  try {
    const data = searchEvents(query.replace(/["']/g, " "), provider, limit, offset);
    return NextResponse.json({ data, nextOffset: data.length === limit ? offset + limit : null });
  }
  catch { return NextResponse.json({ data: [] }); }
}


