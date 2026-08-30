import { NextRequest, NextResponse } from "next/server";
import { PROVIDER_IDS, type FileReferenceAction, type ProviderId } from "@/lib/types";
import { recentFiles } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<FileReferenceAction>(["read", "write", "create", "delete", "unknown"]);

function date(value: string | null) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const from = date(params.get("from"));
  const to = date(params.get("to"));
  if ((params.has("from") && !from) || (params.has("to") && !to) || (from && to && from >= to)) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  const providerValues = params.getAll("provider");
  const actionValues = params.getAll("action");
  if (providerValues.some((value) => !PROVIDER_IDS.includes(value as ProviderId)) || actionValues.some((value) => !ACTIONS.has(value as FileReferenceAction))) {
    return NextResponse.json({ error: "Invalid observed-file filter" }, { status: 400 });
  }
  const providers = providerValues as ProviderId[];
  const actions = actionValues as FileReferenceAction[];
  const limit = boundedInteger(params.get("limit"), 50, 1, 100);
  const offset = boundedInteger(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  try {
    return NextResponse.json(recentFiles({ providers, projects: params.getAll("project"), actions,
      from: from || undefined, to: to || undefined, limit, offset }));
  } catch {
    return NextResponse.json({ error: "Observed files unavailable" }, { status: 500 });
  }
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}
