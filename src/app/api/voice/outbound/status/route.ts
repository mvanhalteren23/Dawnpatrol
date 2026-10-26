import { recordDialStatus } from "@/lib/dialer";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// <Dial action>: how the dialled leg ended (completed, no-answer, busy, failed, canceled).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const q = new URL(req.url).searchParams;
  const callSid = q.get("p") || params.CallSid;
  if (callSid && q.get("a")) {
    await recordDialStatus({ callSid, accountId: q.get("a")!, contactId: q.get("c") || null, status: params.DialCallStatus ?? "", durationSec: Number(params.DialCallDuration ?? 0), dialCallSid: params.DialCallSid ?? null }).catch((e) => console.error("dial status", e));
  }
  return xml(twiml("<Hangup/>"));
}
