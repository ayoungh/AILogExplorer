import "@/lib/server/jobs";
import { NextRequest, NextResponse } from "next/server";
import { getLiveSettings, registerLiveClient, subscribeLiveEvents, type LiveEvent } from "@/lib/server/live";
import { mutationAllowed } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeEvent(event: LiveEvent) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function GET(request: NextRequest) {
  const hasExactOrigin = request.headers.has("origin") && mutationAllowed(request);
  const hasSameOriginFetchContext = !request.headers.has("origin")
    && mutationAllowed(request)
    && request.headers.get("sec-fetch-site") === "same-origin";
  if (!hasExactOrigin && !hasSameOriginFetchContext) {
    return NextResponse.json({ error: "Local same-origin request required" }, { status: 403 });
  }
  if (request.signal.aborted) return new Response(null, { status: 499 });
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const unsubscribe = subscribeLiveEvents((event) => {
        if (!closed) controller.enqueue(encoder.encode(encodeEvent(event)));
      });
      const unregister = registerLiveClient();
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15_000);
      controller.enqueue(encoder.encode(`retry: 2000\nevent: connected\ndata: ${JSON.stringify({ settings: getLiveSettings() })}\n\n`));
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        unregister();
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* The client may already have cancelled the stream. */ }
      };
      cleanup = close;
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
