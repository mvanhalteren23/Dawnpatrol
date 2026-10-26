import { db } from "@/lib/db";
import { dialerCallerId, ensureCallActivity } from "@/lib/dialer";
import { dialableNumber, dialOut, say, twiml } from "@/lib/twilio";
import { appBase, twilioParams, xml } from "@/lib/twilio-request";

// TwiML App Voice URL for the browser dialer: Twilio posts here when the browser connects,
// with the custom params (To, accountId, contactId) passed to device.connect().
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  // Only browser clients holding a CRM-issued token reach this; still refuse anything else.
  if (!params.From?.startsWith("client:")) return xml(twiml("<Reject/>"));
  const to = dialableNumber(params.To ?? "");
  const callerId = dialerCallerId();
  const account = params.accountId ? await db.account.findUnique({ where: { id: params.accountId }, select: { id: true } }) : null;
  if (!to || !callerId || !account) return xml(twiml(`${say(!to ? "That number can't be dialled from the CRM." : "The dialer isn't set up.")}<Hangup/>`));

  const contactId = params.contactId || "";
  await ensureCallActivity({ callSid: params.CallSid ?? "", accountId: account.id, contactId: contactId || null, to, userId: params.From.slice("client:".length) || null });
  const q = `a=${account.id}&c=${contactId}&p=${params.CallSid ?? ""}`;
  return xml(dialOut({ to, callerId, action: `${appBase()}/api/voice/outbound/status?${q}`, recordingCallback: params.record === "0" ? null : `${appBase()}/api/voice/outbound/recording?${q}` }));
}
