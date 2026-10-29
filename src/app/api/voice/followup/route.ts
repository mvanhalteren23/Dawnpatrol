import { followupTwiml } from "@/lib/followup";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// Twilio asks what to do once the lead's phone answers (after answering-machine detection).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const leadId = new URL(req.url).searchParams.get("lead");
  if (!leadId) return xml(twiml("<Hangup/>"));
  return xml(await followupTwiml(leadId, params.AnsweredBy ?? "unknown"));
}
