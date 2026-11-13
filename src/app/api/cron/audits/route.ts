import { NextResponse } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { processAudits } from "@/lib/call-audit";
import { processCustomerTexts } from "@/lib/customer-texts";
import { processCheckins } from "@/lib/owner-checkin";
import { processDueLeads } from "@/lib/followup";

export const maxDuration = 300;

// Every 30 minutes in the day: call audits (place due calls, collect transcripts, analyse,
// write reports), appointment reminders and review requests, and owner check-ins. Called every 30 minutes during the day by .github/workflows/call-audits.yml (Vercel Hobby
// crons only run daily), and by the daily calls-sync job as a backstop.
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const audits = await processAudits().catch((e: Error) => ({ error: e.message }));
  const texts = await processCustomerTexts().catch((e: Error) => ({ error: e.message }));
  const checkins = await processCheckins().catch((e: Error) => ({ error: e.message }));
  // Website leads that came in outside calling hours: called as soon as calling hours start.
  const leads = await processDueLeads(10).catch((e: Error) => e.message);
  // Warn the team before voice credits or the phone balance run out.
  const health = await (await import("@/lib/launch-check")).healthAlerts().catch((e: Error) => e.message);
  return NextResponse.json({ audits, texts, checkins, leads, health });
}
