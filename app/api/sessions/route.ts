import { NextRequest, NextResponse } from "next/server";
import { PROVIDER_IDS, type ProviderId } from "@/lib/types";
import { listSessions } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const providerValue = params.get("provider");
  const provider = PROVIDER_IDS.includes(providerValue as ProviderId) ? providerValue as ProviderId : undefined;
  const limit = Math.min(Number(params.get("limit") || 100), 250);
  const offset = Math.max(Number(params.get("offset") || 0), 0);
  const data = listSessions({ provider, query: params.get("query") || undefined, limit, offset });
  return NextResponse.json({ data, nextOffset: data.length === limit ? offset + limit : null });
}


