import { say, twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// <Record action> for recording a voicemail: confirm and hang up.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  return xml(twiml(`${say("Got it. Your voicemail is saved.")}<Hangup/>`));
}
