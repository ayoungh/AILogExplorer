import { NextResponse } from "next/server";
import { getSession, getSessionMetrics } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getSession(id)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const metrics = getSessionMetrics(id);
  return metrics ? NextResponse.json(metrics) : NextResponse.json({ error: "Metrics unavailable" }, { status: 404 });
}
