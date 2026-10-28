import { NextResponse } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { syncCalls } from "@/lib/call-sync";
import { runScheduledReports } from "@/lib/client-reports";

export const maxDuration = 300;

// Daily (vercel.json cron, 14:00 UTC = 6–7am Pacific): backfill ElevenLabs calls into CallLog, then
// email clients any weekly/monthly call reports that are due, so reports include every call.
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = await syncCalls();
  const reports = await runScheduledReports().catch((err: Error) => [{ error: err.message }]);
  return NextResponse.json({ ...sync, reports });
}
