import { NextRequest, NextResponse } from "next/server";
import { getDb, resetDb } from "@/lib/server/db";
import { mutationAllowed } from "@/lib/server/security";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: "Local same-origin request required" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "CLEAR LOCAL INDEX") return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  const active = getDb().prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").get();
  if (active) return NextResponse.json({ error: "Cancel the active job before clearing the index" }, { status: 409 });
  resetDb();
  return NextResponse.json({ ok: true });
}


