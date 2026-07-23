import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { startImport } from "@/lib/server/jobs";
import { mutationAllowed } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: "Local same-origin request required" }, { status: 403 });
  if (!request.body) return NextResponse.json({ error: "No file body" }, { status: 400 });
  const original = decodeURIComponent(request.headers.get("x-file-name") || "import.data");
  const safe = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, "-");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-log-import-"));
  const target = path.join(directory, safe);
  try {
    await pipeline(Readable.fromWeb(request.body as never), createWriteStream(target, { flags: "wx" }));
    const job = await startImport(target, original);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 500 });
  }
}


