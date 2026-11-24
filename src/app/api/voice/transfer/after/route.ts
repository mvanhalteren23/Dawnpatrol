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
  const from = params.From ?? "";
  const to = params.To ?? "";
  const callSid = params.CallSid ?? "";
  // Our own line: Grace comes back with her usual caller details, opening with an apology.
  if (r.bookingAddsToCrm && r.agentType === "inbound" && r.elevenLabsAgentId) {
    const [{ callerContext }, { registerTwilioCall }, { routingForCall }, { guardedHandoff, agentUnavailable }] = await Promise.all([import("@/lib/house-line"), import("@/lib/elevenlabs"), import("@/lib/assistant"), import("@/lib/agent-fallback")]);
    try {
      const ctx = await callerContext(from, r.greeting);
      const handoff = await registerTwilioCall(r.elevenLabsAgentId, from, to, {
        dynamicVariables: { ...ctx, opening: `Sorry, nobody picked up. It's ${r.name} again: can I take a message?`, caller_routing: await routingForCall(r, from, { transferFailed: true }), call_sid: callSid },
      });
      return xml(guardedHandoff(r, handoff));
    } catch (err) {
      return xml(await agentUnavailable(r, (err as Error).message ?? "the agent couldn't be reached"));
    }
  }
  return xml(await toAgent(r, from, to, callSid, { transferFailed: true }));
}
