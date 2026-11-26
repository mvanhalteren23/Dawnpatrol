import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { ingestLeads } from "@/lib/prospect-leads";
import { parseIntake } from "@/lib/prospect-leads-rules";

// Researched leads intake. The prospecting skill posts here from the CRM tab in Chrome (your
// signed-in session), or a script posts with `Authorization: Bearer $LEADS_API_TOKEN`.
// Body: { search: { industry, region }, leads: [{ name, website, phone, city, region, channels, evidence, signals, googleRating, reviewCount, notes }] }
// Each lead may carry a fact-only `profile` (prospect-pack prospect shape). The response lists
// every lead with `needsProfile`, so the skill researches only those that still need one.
export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const viaToken = verifySharedSecret(bearer, process.env.LEADS_API_TOKEN);
  const session = viaToken ? null : await apiSession("STAFF");
  if (!viaToken && !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const intake = parseIntake(body);
  if (typeof intake === "string") return NextResponse.json({ error: intake }, { status: 400 });
  const summary = await ingestLeads(intake, { source: viaToken ? "api" : "skill", createdById: session?.sub ?? null });
  return NextResponse.json({ ok: true, ...summary, review: "/crm/leads" });
}
