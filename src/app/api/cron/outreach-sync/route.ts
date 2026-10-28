import { NextResponse } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { googleConnection } from "@/lib/google";
import { db } from "@/lib/db";
import { syncGmail, writeOutreachLog } from "@/lib/outreach";

export const maxDuration = 300;

// Scheduled Gmail → CRM sync (vercel.json cron, or any scheduler hitting this URL).
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await googleConnection()).connected && !(await db.googleAccount.count())) return NextResponse.json({ skipped: "Google not connected" });
  const result = await syncGmail();
  for (const id of result.accountsTouched) await writeOutreachLog(id).catch((e) => console.warn("outreach log", e));
  return NextResponse.json(result);
}
