import { db } from "@/lib/db";
import { nextDialTwiml, waitTwiml } from "@/lib/dialer-bridge";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// Between calls: the rep's phone waits in silence (5 minutes at a time, up to 15 idle).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const q = new URL(req.url).searchParams;
  const b = q.get("b") ?? "";
  const bridge = await db.dialerBridge.findUnique({ where: { id: b } });
  if (!bridge || bridge.state === "ENDED" || (bridge.repCallSid ?? params.CallSid) !== params.CallSid) return xml(twiml("<Hangup/>"));
  const next = await nextDialTwiml(b);
  if (next) return xml(next);
  const n = Math.max(0, Math.min(10, Number(q.get("n") ?? 0) || 0));
  return xml(waitTwiml(b, n, null));
}
