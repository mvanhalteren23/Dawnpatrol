import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// The owner's key press: 1 connects the caller (an empty response bridges the call); anything
// else hangs up this leg, so the caller goes on to the receptionist.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  return xml(params.Digits === "1" ? twiml("") : twiml("<Hangup/>"));
}
