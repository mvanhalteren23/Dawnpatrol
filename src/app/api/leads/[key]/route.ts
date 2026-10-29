import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callAfterDelay, intakeLead, processDueLeads } from "@/lib/followup";

// Website form → follow-up agent. Two ways in:
// - the form we give the client (HTML that posts here, then sends the visitor to a thank-you page);
// - any form builder or Zapier/Make sending JSON or form fields here.
// The key in the address identifies the client's follow-up agent. It's public (it sits in the
// website's HTML), so: a honeypot field, a per-agent hourly cap, phone validation, duplicate and
// do-not-call checks, and calls only within the agent's calling hours.
export const maxDuration = 300; // the call starts after the configured short delay

const MAX_PER_HOUR = 30;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function readBody(req: Request): Promise<{ fields: Record<string, unknown>; browserForm: boolean }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as unknown;
    return { fields: json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {}, browserForm: false };
  }
  const form = await req.formData().catch(() => null);
  const fields: Record<string, unknown> = {};
  form?.forEach((v, k) => {
    if (typeof v === "string") fields[k] = fields[k] ? `${fields[k]}, ${v}` : v;
  });
  return { fields, browserForm: (req.headers.get("accept") ?? "").includes("text/html") };
}

function safeRedirect(url: unknown, fallback: string): string {
  try {
    const u = new URL(String(url ?? ""));
    return u.protocol === "https:" ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const r = await db.receptionist.findUnique({ where: { leadFormKey: key } });
  if (!r || r.agentType !== "followup") return NextResponse.json({ error: "Unknown form" }, { status: 404, headers: CORS });

  const { fields, browserForm } = await readBody(req);
  const reply = (body: Record<string, unknown>, status = 200, soon = true) => {
    if (!browserForm) return NextResponse.json(body, { status, headers: CORS });
    const thanks = `${new URL(req.url).origin}/lead-received?b=${encodeURIComponent(r.businessName)}${soon ? "" : "&later=1"}`;
    return NextResponse.redirect(safeRedirect(fields.redirect, thanks), 303);
  };

  // Bots fill hidden fields; people don't. Pretend it worked.
  if (String(fields.website_url ?? fields._gotcha ?? "").trim()) return reply({ ok: true });
  const recent = await db.lead.count({ where: { receptionistId: r.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  if (recent >= MAX_PER_HOUR) return reply({ error: "Too many requests; try again later" }, 429);

  const consent = /^(yes|on|true|1)$/i.test(String(fields.consent ?? "")) || !browserForm; // connected forms carry their own consent wording
  const { lead, action } = await intakeLead(r, fields, { source: browserForm ? "form" : "webhook", consent });
  if (action === "calling") after(() => callAfterDelay(r, lead.id));
  after(() => processDueLeads(5).catch((e) => console.error("follow-up sweep", e)));
  return reply({ ok: true, status: action }, 200, action === "calling");
}
