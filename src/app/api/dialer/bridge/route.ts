import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeBridge, endBridge, hangUpLeg, requestDial, startBridge } from "@/lib/dialer-bridge";
import { legPhase, maskPhone } from "@/lib/dialer-bridge-rules";

// "Call my phone" dialer, from the app. GET ?b= reads the session (polled while calling).
// POST { action: "start" | "dial" | "hangup" | "end" }.

export async function GET(req: Request) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("b");
  const b = id ? await db.dialerBridge.findFirst({ where: { id, userId: session.sub } }) : await activeBridge(session.sub);
  if (!b) return NextResponse.json({ state: "NONE" }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { id: b.id, state: b.state, phone: maskPhone(b.phone), legKey: b.legKey, legStatus: b.legStatus, legPhase: legPhase(b.legStatus), pending: Boolean(b.pending), endedReason: b.endedReason },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await apiSession("STAFF");
  if (!session || (session.role !== "ADMIN" && session.role !== "REP")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; bridgeId?: string; accountId?: string; contactId?: string; to?: string; vm?: string; vmId?: string };
  switch (body.action) {
    case "start":
      return NextResponse.json(await startBridge(session.sub));
    case "dial": {
      if (!body.bridgeId || !body.accountId || !body.to) return NextResponse.json({ error: "Missing call details" }, { status: 400 });
      const res = await requestDial(session.sub, session.role, body.bridgeId, { accountId: body.accountId, contactId: body.contactId || null, to: body.to, vm: body.vm ?? null, vmId: body.vmId ?? "" });
      return NextResponse.json(res, { status: "error" in res ? 409 : 200 });
    }
    case "hangup":
      if (body.bridgeId) await hangUpLeg(session.sub, body.bridgeId);
      return NextResponse.json({ ok: true });
    case "end":
      if (body.bridgeId) await endBridge(session.sub, body.bridgeId);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
