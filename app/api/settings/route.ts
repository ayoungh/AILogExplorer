import "@/lib/server/jobs";
import { NextRequest, NextResponse } from "next/server";
import { getLiveSettings, setLiveUpdatesEnabled } from "@/lib/server/live";
import { mutationAllowed } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getLiveSettings());
}

export async function PATCH(request: NextRequest) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: "Local same-origin request required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { liveUpdates?: unknown } | null;
  if (!body || typeof body.liveUpdates !== "boolean") return NextResponse.json({ error: "liveUpdates must be a boolean" }, { status: 400 });
  return NextResponse.json(setLiveUpdatesEnabled(body.liveUpdates));
}

export const PUT = PATCH;
