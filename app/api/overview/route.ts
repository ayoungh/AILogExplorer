import { NextResponse } from "next/server";
import { overview } from "@/lib/server/repository";
import { recoverOrphanedJobs } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  recoverOrphanedJobs();
  const value = overview();
  return NextResponse.json({
    ...value,
    encryptedChatGptCache: value.providers.some((provider) => provider.id === "chatgpt" && provider.status === "warning"),
  });
}


