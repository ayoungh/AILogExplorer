import packageJson from "@/package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", version: packageJson.version });
}
