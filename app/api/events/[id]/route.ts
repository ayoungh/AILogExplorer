import { NextResponse } from "next/server";
import { getEvent } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const event = getEvent((await context.params).id);
  return event ? NextResponse.json(event) : NextResponse.json({ error: "Event not found" }, { status: 404 });
}


