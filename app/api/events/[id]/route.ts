import { NextResponse } from "next/server";
import type { EventContentPart } from "@/lib/types";
import { previewJsonText, streamJsonText } from "@/lib/server/compression";
import { getEvent, getEventContent } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_PARTS: EventContentPart[] = ["input", "output", "raw"];
const PREVIEW_BYTES = 256 * 1024;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const partValue = url.searchParams.get("part");
  if (!partValue) {
    const event = getEvent(id);
    return event ? NextResponse.json(event) : NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!CONTENT_PARTS.includes(partValue as EventContentPart)) {
    return NextResponse.json({ error: "Unsupported event content part" }, { status: 400 });
  }

  const part = partValue as EventContentPart;
  const content = getEventContent(id, part);
  if (!content) return NextResponse.json({ error: "Event content not found" }, { status: 404 });

  if (url.searchParams.get("mode") === "download") {
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${id}-${part}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    });
    if (content.bytes != null) headers.set("Content-Length", String(content.bytes));
    return new Response(streamJsonText(content.data, content.encoding), { headers });
  }

  const preview = await previewJsonText(content.data, content.encoding, PREVIEW_BYTES);
  return NextResponse.json({
    part,
    text: preview.text,
    truncated: preview.truncated,
    bytes: content.bytes ?? preview.bytes,
  }, { headers: { "Cache-Control": "no-store" } });
}

