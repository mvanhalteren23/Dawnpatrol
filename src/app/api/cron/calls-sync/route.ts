import { NextResponse } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { syncCalls } from "@/lib/call-sync";
import { runScheduledReports } from "@/lib/client-reports";
import { processDueLeads } from "@/lib/followup";
import { processAudits } from "@/lib/call-audit";
import { expireIdleDemos } from "@/lib/agent-lifecycle";
import { cleanupBuilderKeys } from "@/lib/live-builder";
import { processCustomerTexts } from "@/lib/customer-texts";

export const maxDuration = 300;

// Daily (vercel.json cron, 17:00 UTC = 9–10am Pacific, after calling hours open): backfill ElevenLabs calls into CallLog, then
// email clients any weekly/monthly call reports that are due, so reports include every call.
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = await syncCalls();
  const reports = await runScheduledReports().catch((err: Error) => [{ error: err.message }]);
  // Website leads that came in overnight: call them now that calling hours have started.
  const followUpCalls = await processDueLeads(25).catch((err: Error) => err.message);
  // Call audits: backstop for the 20-minute GitHub Actions trigger.
  const audits = await processAudits().catch((err: Error) => err.message);
  // Demo agents idle for 30 days come out of ElevenLabs (kept in the CRM, can be revived).
  const demos = await expireIdleDemos().catch((err: Error) => err.message);
  const cleaned = await cleanupBuilderKeys().catch((err: Error) => err.message);
  // Backstop for the 30-minute sweep: reminders and review requests that are due.
  const texts = await processCustomerTexts().catch((err: Error) => err.message);
  return NextResponse.json({ ...sync, reports, followUpCalls, audits, demos, cleaned, texts });
}
