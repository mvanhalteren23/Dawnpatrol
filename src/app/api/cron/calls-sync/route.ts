import { NextResponse } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { syncCalls } from "@/lib/call-sync";

export const maxDuration = 300;

// Scheduled ElevenLabs → CallLog backfill (vercel.json cron, or any scheduler hitting this URL).
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await syncCalls());
}
