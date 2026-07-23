import type { NextRequest } from "next/server";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackRequest(request: NextRequest | Request) {
  try { return LOOPBACK_HOSTS.has(new URL(request.url).hostname); } catch { return false; }
}

export function mutationAllowed(request: NextRequest | Request) {
  if (!isLoopbackRequest(request)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const host = request.headers.get("host");
    return Boolean(host) && LOOPBACK_HOSTS.has(source.hostname) && source.host === host;
  } catch { return false; }
}


