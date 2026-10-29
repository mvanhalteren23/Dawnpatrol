import { auditTwiml } from "@/lib/call-audit";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// Twilio asks what to do once the audited business's phone answers (after machine detection).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const callId = new URL(req.url).searchParams.get("call");
  if (!callId) return xml(twiml("<Hangup/>"));
  return xml(await auditTwiml(callId, params));
}
