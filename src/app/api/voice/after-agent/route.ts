import { db } from "@/lib/db";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { agentDropped } from "@/lib/agent-fallback-rules";
import { agentUnavailable } from "@/lib/agent-fallback";

// Twilio asks this when the voice agent's audio stream ends. A normal call just ends. If the
// stream ended within seconds and the caller is still there, the agent failed (out of credits,
// an outage): the caller leaves a voicemail instead of hearing silence.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const url = new URL(req.url);
  if (!agentDropped(Number(url.searchParams.get("t")), Date.now(), params.CallStatus)) return xml(twiml("<Hangup/>"));
  const r = await db.receptionist.findUnique({ where: { id: url.searchParams.get("r") ?? "" }, select: { id: true, businessName: true } }).catch(() => null);
  if (!r) return xml(twiml("<Hangup/>"));
  console.error("agent dropped the call in its first seconds", { receptionist: r.id, callSid: params.CallSid });
  return xml(await agentUnavailable(r, "the call was dropped as soon as it connected"));
}
