import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackRequest } from "@/lib/server/security";

export function proxy(request: NextRequest) {
  if (!isLoopbackRequest(request)) return new NextResponse("AI Log Explorer is available on this Mac only.", { status: 403 });
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = { matcher: "/:path*" };


