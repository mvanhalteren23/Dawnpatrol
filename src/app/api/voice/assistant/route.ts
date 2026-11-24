import { db } from "@/lib/db";
import { toAgent } from "@/lib/business-line";
import { twiml } from "@/lib/twilio";
import { handedOffTo } from "@/lib/house-line";
import { twilioParams, xml } from "@/lib/twilio-request";

// Grace put an Assistant client through (open_assistant): hand the live call to their own
// assistant. It recognises them as the owner from their number, as on their own line.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const id = new URL(req.url).searchParams.get("r") ?? "";
  const callSid = params.CallSid ?? "";
  const r = id && (await handedOffTo(callSid, id)) ? await db.receptionist.findUnique({ where: { id } }) : null;
  if (!r) return xml(twiml("<Say>Sorry, that didn't connect. Please call back.</Say><Hangup/>"));
  return xml(await toAgent(r, params.From ?? "", params.To ?? "", callSid));
}
