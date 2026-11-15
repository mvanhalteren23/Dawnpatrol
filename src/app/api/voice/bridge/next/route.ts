import { db } from "@/lib/db";
import { nextDialTwiml, waitTwiml } from "@/lib/dialer-bridge";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// The app queued a prospect: the rep's call is redirected here and dials them.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const b = new URL(req.url).searchParams.get("b") ?? "";
  const bridge = await db.dialerBridge.findUnique({ where: { id: b } });
  if (!bridge || bridge.state === "ENDED" || (bridge.repCallSid ?? params.CallSid) !== params.CallSid) return xml(twiml("<Hangup/>"));
  return xml((await nextDialTwiml(b)) ?? waitTwiml(b, 0, null));
}
