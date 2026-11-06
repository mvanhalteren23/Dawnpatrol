import { db } from "@/lib/db";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { sendLeadAlert } from "@/lib/follow-up";
import { VOICEMAIL_SECONDS } from "@/lib/call-guard-rules";

// While a line's daily cutoff is tripped, callers leave a 2-minute voicemail (src/lib/call-guard.ts):
// step=done ends the call; step=transcript logs the message and texts the owner as a lead alert.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const url = new URL(req.url);
  if (url.searchParams.get("step") !== "transcript") return xml(twiml("<Hangup/>"));
  const r = await db.receptionist.findUnique({ where: { id: url.searchParams.get("r") ?? "" } });
  const callSid = params.CallSid ?? "";
  if (!r || !/^CA[0-9a-f]{32}$/i.test(callSid)) return xml(twiml(""));
  const text = (params.TranscriptionText ?? "").trim();
  const call = await db.callLog.upsert({
    where: { externalId: `vm-${callSid}` },
    create: {
      receptionistId: r.id,
      externalId: `vm-${callSid}`,
      callerNumber: params.From || null,
      startedAt: new Date(),
      durationSec: Math.min(VOICEMAIL_SECONDS, Number(params.RecordingDuration ?? 0) || 0),
      summary: `Voicemail (the line was paused for unusual call volume): ${text || "no words could be transcribed"}`.slice(0, 2000),
      transcript: text,
      outcome: "MESSAGE_TAKEN",
      followUpNeeded: Boolean(text),
    },
    update: {},
  });
  await sendLeadAlert(r, call).catch((e) => console.error("voicemail alert failed", e));
  return xml(twiml(""));
}
