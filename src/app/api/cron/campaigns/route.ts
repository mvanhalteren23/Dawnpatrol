import { NextResponse, after } from "next/server";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { runCampaigns } from "@/lib/campaigns";

export const maxDuration = 300;

// Campaign sending run: replies and bounces first, then the next few emails per inbox.
// Pinged every 30 minutes in the daytime by the GitHub "Daytime sweep" workflow.
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifySharedSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runCampaigns();
  // Demo agents for people who replied (or top prospects) are built after responding.
  if (result.demoRuns.length) {
    after(async () => {
      const { executeDemoResearch } = await import("@/lib/demo-research");
      for (const id of result.demoRuns) await executeDemoResearch(id);
    });
  }
  return NextResponse.json(result);
}
