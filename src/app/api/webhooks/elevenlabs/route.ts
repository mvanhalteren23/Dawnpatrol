import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { type PostCallData } from "@/lib/calls";
import { saveCallLog } from "@/lib/call-store";
import { verifyElevenLabsSignature } from "@/lib/webhook-verify";
import { writeAccountDoc } from "@/lib/drive";
import { googleConnection } from "@/lib/google";
import { getSetting, setSetting } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

// ElevenLabs post-call webhook → CallLog (+ monthly call log doc in the client's Drive folder).
// The pull-based sync in lib/call-sync.ts is the backstop if this webhook isn't configured.
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "ELEVENLABS_WEBHOOK_SECRET not set" }, { status: 500 });
  if (!verifyElevenLabsSignature(raw, req.headers.get("elevenlabs-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const payload = JSON.parse(raw) as { type?: string; data?: PostCallData };
  if (payload.type !== "post_call_transcription" || !payload.data?.conversation_id) return NextResponse.json({ ignored: true });
  const data = payload.data;

  const receptionist = data.agent_id ? await db.receptionist.findFirst({ where: { elevenLabsAgentId: data.agent_id } }) : null;
  if (!receptionist) return NextResponse.json({ ignored: "unknown agent" });

  // The webhook only fires for finished calls; don't let a status field filter it out.
  const call = await saveCallLog(receptionist, { ...data, status: "done" });
  if (!call) return NextResponse.json({ ignored: true });
  const startedAt = call.startedAt;

  after(async () => {
    try {
      if (!(await googleConnection()).connected) return;
      const month = startedAt.toISOString().slice(0, 7);
      const key = `drive.callLog.${receptionist.id}.${month}`;
      const calls = await db.callLog.findMany({
        where: { receptionistId: receptionist.id, startedAt: { gte: new Date(`${month}-01T00:00:00Z`) } },
        orderBy: { startedAt: "desc" },
      });
      const body = calls.map((c) => `${formatDate(c.startedAt, true)} · ${c.outcome} · ${c.callerName ?? ""} ${c.callerNumber ?? ""}\n${c.summary}\n`).join("\n");
      const file = await writeAccountDoc(receptionist.accountId, "CALL_LOGS", `Call Log — ${month}`, `Call log ${month} — ${receptionist.businessName}\n\n${body}`, await getSetting(key));
      await setSetting(key, file.id);
    } catch (err) {
      console.warn("call log drive sync failed", err);
    }
  });

  return NextResponse.json({ ok: true, id: call.id, outcome: call.outcome });
}
