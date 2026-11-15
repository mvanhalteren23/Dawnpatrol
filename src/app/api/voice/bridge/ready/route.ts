import { db } from "@/lib/db";
import { nextDialTwiml, waitTwiml } from "@/lib/dialer-bridge";
import { say, twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// The rep pressed a key: the line is open. Dial straight away if the app already queued a call.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const b = new URL(req.url).searchParams.get("b") ?? "";
  const bridge = await db.dialerBridge.findUnique({ where: { id: b } });
  if (!bridge || bridge.state === "ENDED" || (bridge.repCallSid ?? params.CallSid) !== params.CallSid) return xml(twiml("<Hangup/>"));
  if (params.Digits !== "1") return xml(twiml(`${say("That wasn't 1. Goodbye.")}<Hangup/>`));
  await db.dialerBridge.update({ where: { id: b }, data: { state: bridge.pending ? "DIALING" : "READY" } });
  const next = await nextDialTwiml(b);
  return xml(next ?? waitTwiml(b, 0, "You're connected. Calls will start from the app."));
}
