import { recordDialStatus } from "@/lib/dialer";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { sessionForParent } from "@/lib/live-builder";
import { joinConferenceTwiml } from "@/lib/builder-rules";

// <Dial action>: how the dialled leg ended (completed, no-answer, busy, failed, canceled).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const q = new URL(req.url).searchParams;
  const callSid = q.get("p") || params.CallSid;
  if (callSid && q.get("a")) {
    await recordDialStatus({ callSid, accountId: q.get("a")!, contactId: q.get("c") || null, status: params.DialCallStatus ?? "", durationSec: Number(params.DialCallDuration ?? 0), dialCallSid: params.DialCallSid ?? null }).catch((e) => console.error("dial status", e));
  }
  // The rep added the demo builder: the prospect's leg moved to a conference, so the rep joins it too.
  const builder = callSid ? await sessionForParent(callSid).catch(() => null) : null;
  if (builder && !["no-answer", "busy", "failed", "canceled"].includes(params.DialCallStatus ?? "")) return xml(joinConferenceTwiml(builder.code, "rep"));
  return xml(twiml("<Hangup/>"));
}
