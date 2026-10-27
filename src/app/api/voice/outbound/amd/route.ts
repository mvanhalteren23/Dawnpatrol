import { after } from "next/server";
import { db } from "@/lib/db";
import { ensureCallActivity } from "@/lib/dialer";
import { aiVoicemail, cachedAiVoicemail, dropVoicemail, hangUpCall, voicemailSettings } from "@/lib/voicemail";
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

  // Voicemail first: every millisecond here is dead air on their voicemail before the message.
  if (isMachineEnd(answeredBy) && (mode === "recorded" || mode === "ai")) {
    let note: string;
    let ok = false;
    try {
      const vm = await pickVoicemail(mode, accountId, q.get("vmId"));
      await dropVoicemail(child, vm);
      ok = true;
      note = vm.note;
    } catch (err) {
      console.error("voicemail drop", err);
      note = `Voicemail drop failed: ${(err as Error).message}`;
    }
    after(async () => {
      const call = await ensureCallActivity({ callSid: parent, accountId, contactId: q.get("c") || null });
      await db.activity.update({
        where: { id: call.id },
        data: {
          answeredBy,
          ...(ok ? { outcome: "voicemail", subject: `Call — ${mode === "ai" ? "AI voicemail left" : "voicemail dropped"}` } : {}),
          body: [call.body, note].filter(Boolean).join("\n\n"),
        },
      });
    });
    return new Response(null, { status: 204 });
  }

  const call = await ensureCallActivity({ callSid: parent, accountId, contactId: q.get("c") || null });
  await db.activity.update({ where: { id: call.id }, data: { answeredBy } });

  if (answeredBy === "fax" || (isMachineEnd(answeredBy) && mode === "hangup")) {
    after(() => hangUpCall(child).catch((e) => console.error("amd hangup", e)));
    await db.activity.update({ where: { id: call.id }, data: { outcome: "no_answer", subject: answeredBy === "fax" ? "Call — fax line" : "Call — voicemail (hung up)" } });
  }
  return new Response(null, { status: 204 });
}

/**
 * The voicemail to drop. AI mode uses the one pre-written when the session started (or while it
 * rang); only if none is ready does it fall back to your recorded voicemail, and only if you
 * have none does it write one now (slow: a pause on their voicemail).
 */
async function pickVoicemail(mode: string, accountId: string, vmId: string | null): Promise<{ id: string | null; script: string | null; note: string }> {
  const recordedNote = "Pre-recorded voicemail dropped.";
  if (mode === "recorded") {
    const id = vmId || (await voicemailSettings()).defaultId;
    if (!id) throw new Error("No voicemail recorded yet (Dialer → Voicemail settings)");
    return { id, script: null, note: recordedNote };
  }
  const aiNote = (vm: { id: string | null; script: string }) =>
    `Voicemail left by the AI assistant${vm.id ? "" : " (read by Twilio's voice; the ElevenLabs voice wasn't available)"}:\n${vm.script}`;
  const cached = await cachedAiVoicemail(accountId);
  if (cached?.id) return { ...cached, note: aiNote(cached) };
  const recorded = (await voicemailSettings()).defaultId;
  if (recorded) return { id: recorded, script: null, note: `${recordedNote} (The AI voicemail wasn't ready in time.)` };
  const vm = cached?.script ? cached : await aiVoicemail(accountId);
  return { ...vm, note: aiNote(vm) };
}
