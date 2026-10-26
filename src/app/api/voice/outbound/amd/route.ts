import { after } from "next/server";
import { db } from "@/lib/db";
import { ensureCallActivity } from "@/lib/dialer";
import { aiVoicemail, dropVoicemail, hangUpCall, voicemailSettings } from "@/lib/voicemail";
import { isMachineEnd } from "@/lib/twilio";
import { twilioParams } from "@/lib/twilio-request";

// Answering-machine detection result for the dialled leg (CallSid = the prospect's leg).
// vm=recorded|ai → take over that leg after the beep and leave the voicemail (the rep's browser
// leg ends and the auto-dialer moves on); vm=hangup → end it; vm=self → just report it.
export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const q = new URL(req.url).searchParams;
  const parent = q.get("p") ?? "";
  const accountId = q.get("a") ?? "";
  const mode = q.get("vm") ?? "self";
  const answeredBy = params.AnsweredBy ?? "unknown";
  const child = params.CallSid ?? "";
  if (!parent || !accountId) return new Response(null, { status: 204 });

  const call = await ensureCallActivity({ callSid: parent, accountId, contactId: q.get("c") || null });
  await db.activity.update({ where: { id: call.id }, data: { answeredBy } });

  if (answeredBy === "fax" || (isMachineEnd(answeredBy) && mode === "hangup")) {
    after(() => hangUpCall(child).catch((e) => console.error("amd hangup", e)));
    await db.activity.update({ where: { id: call.id }, data: { outcome: "no_answer", subject: answeredBy === "fax" ? "Call — fax line" : "Call — voicemail (hung up)" } });
    return new Response(null, { status: 204 });
  }

  if (isMachineEnd(answeredBy) && (mode === "recorded" || mode === "ai")) {
    const settings = await voicemailSettings();
    try {
      const vm = mode === "ai" ? await aiVoicemail(accountId) : { id: q.get("vmId") || settings.defaultId, script: null };
      if (!vm.id && !vm.script) throw new Error("No voicemail recorded yet (Dialer → Voicemail settings)");
      await dropVoicemail(child, vm);
      await db.activity.update({
        where: { id: call.id },
        data: {
          outcome: "voicemail",
          subject: `Call — ${mode === "ai" ? "AI voicemail left" : "voicemail dropped"}`,
          body: [call.body, mode === "ai" ? `Voicemail left by the AI assistant:\n${vm.script}` : "Pre-recorded voicemail dropped."].filter(Boolean).join("\n\n"),
        },
      });
    } catch (err) {
      console.error("voicemail drop", err);
      await db.activity.update({ where: { id: call.id }, data: { body: [call.body, `Voicemail drop failed: ${(err as Error).message}`].filter(Boolean).join("\n") } });
    }
  }
  return new Response(null, { status: 204 });
}
