import { NextResponse } from "next/server";
import { getDataMap } from "@/lib/server/data-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getDataMap());
}
