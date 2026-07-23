import { NextRequest, NextResponse } from "next/server";
import { startScan } from "@/lib/server/jobs";
import { mutationAllowed } from "@/lib/server/security";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: "Local same-origin request required" }, { status: 403 });
  return NextResponse.json(startScan(), { status: 202 });
}


