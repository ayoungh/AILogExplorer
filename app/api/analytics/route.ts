import { NextRequest, NextResponse } from "next/server";
import { PROVIDER_IDS, type ProviderId } from "@/lib/types";
import { analytics } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function date(value: string | null, fallback: Date) {
  if (!value) return fallback.toISOString();
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const now = new Date();
  const fromFallback = new Date(now.getTime() - 30 * 86_400_000);
  const from = date(params.get("from"), fromFallback);
  const to = date(params.get("to"), now);
  if (!from || !to || from >= to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  const timezone = params.get("timezone") || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now); }
  catch { return NextResponse.json({ error: "Invalid timezone" }, { status: 400 }); }
  const providerValues = params.getAll("provider");
  if (providerValues.some((value) => !PROVIDER_IDS.includes(value as ProviderId))) return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  const providers = providerValues as ProviderId[];
  try {
    return NextResponse.json(analytics({ from, to, timezone, providers, projects: params.getAll("project"), models: params.getAll("model") }));
  } catch {
    return NextResponse.json({ error: "Analytics unavailable" }, { status: 500 });
  }
}
