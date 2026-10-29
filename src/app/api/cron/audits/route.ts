import { NextResponse } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { processAudits } from "@/lib/call-audit";

export const maxDuration = 300;

// Call audits: place calls that are due, collect transcripts, analyse, write reports.
// Called every 20 minutes during the day by .github/workflows/call-audits.yml (Vercel Hobby
// crons only run daily), and by the daily calls-sync job as a backstop.
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await processAudits());
}
