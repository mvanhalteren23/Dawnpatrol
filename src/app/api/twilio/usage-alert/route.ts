import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { alertTeam } from "@/lib/call-guard";

// Twilio usage trigger (CRM → Settings → Call protection): daily Twilio spend passed the amount set.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const value = Number(params.CurrentValue ?? 0);
  const limit = Number(params.TriggerValue ?? 0);
  await alertTeam(
    "Twilio spending alert",
    `Twilio spend today is US$${value.toFixed(2)}, past your alert of US$${limit.toFixed(2)}. Check the call logs for a burst of calls from one number, block it, and look at Twilio → Monitor → Calls.`,
  ).catch((e) => console.error("usage alert failed", e));
  return xml(twiml(""));
}
