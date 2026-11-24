import { db } from "@/lib/db";
import { toAgent } from "@/lib/business-line";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// <Dial action> after a transfer: answered = done; otherwise the agent comes back on, is told the
// transfer wasn't answered, and takes a message (it won't try to put them through again).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  if (params.DialCallStatus === "completed") return xml(twiml("<Hangup/>"));
  const r = await db.receptionist.findUnique({ where: { id: new URL(req.url).searchParams.get("r") ?? "" } });
  if (!r) return xml(twiml("<Hangup/>"));
  return xml(await toAgent(r, params.From ?? "", params.To ?? "", params.CallSid ?? "", { transferFailed: true }));
}
