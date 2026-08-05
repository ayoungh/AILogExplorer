import { NextRequest, NextResponse } from "next/server";
import { DATA_CONCEPT_IDS, PROVIDER_IDS, type DataConceptId, type ProviderId } from "@/lib/types";
import { getDataMapSample } from "@/lib/server/data-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const providerValue = request.nextUrl.searchParams.get("provider");
  const conceptValue = request.nextUrl.searchParams.get("concept");
  const indexValue = request.nextUrl.searchParams.get("index") || "0";
  if (!PROVIDER_IDS.includes(providerValue as ProviderId) || providerValue === "claude-export") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (!DATA_CONCEPT_IDS.includes(conceptValue as DataConceptId)) {
    return NextResponse.json({ error: "Unknown data concept" }, { status: 400 });
  }
  if (!/^\d+$/.test(indexValue)) {
    return NextResponse.json({ error: "Sample index must be a non-negative integer" }, { status: 400 });
  }
  const sample = getDataMapSample(providerValue as ProviderId, conceptValue as DataConceptId, Number(indexValue));
  return sample ? NextResponse.json(sample) : NextResponse.json({ error: "No sample is available" }, { status: 404 });
}
