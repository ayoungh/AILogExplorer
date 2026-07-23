import { NextRequest, NextResponse } from "next/server";
import { cancelJob, getJob } from "@/lib/server/jobs";
import { mutationAllowed } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const job = getJob((await context.params).id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: "Local same-origin request required" }, { status: 403 });
  const job = cancelJob((await context.params).id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}


