import { db } from "@/lib/db";
import { forwardSms, twiml, toE164, escapeXml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { isHandledReply, isOptIn, isOptOut } from "@/lib/follow-up-rules";
import { leadAlertNumbers } from "@/lib/follow-up";
import { after } from "next/server";
import { handleCustomerText, receptionistForSharedText, textsCustomers } from "@/lib/customer-texts";
import { handleOwnerText, ownerCaller } from "@/lib/owner-mode";
import { isClientInbound } from "@/lib/elevenlabs";
import { isBlocked } from "@/lib/call-guard";

// Texts to a business line:
// - STOP / START from anyone: recorded so the line never texts that number again (Twilio also
//   handles the carrier reply itself, so we answer with nothing).
// - From an owner number to their own line: owner updates (closures, hours, calendar blocks, what
//   the agent says), "messages", and UNDO.
// - "1" (or "done") from the owner: marks their latest open lead handled.
// - Anything else from a customer: answered by the text agent (src/lib/customer-texts.ts), which
//   also handles reminder replies and forwards what needs the owner; without it, forwarded as before.
// The shared texting number (clients without a business line) points here too: the reply goes to
// the client who last texted that customer.
export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const r = (await db.receptionist.findUnique({ where: { businessNumber: params.To ?? "" } })) ?? (await receptionistForSharedText(params.From ?? ""));
  const body = params.Body ?? "";
  const from = toE164(params.From ?? "");
  if (!r || !body || !from) return xml(twiml(""));
  if (await isBlocked(from)) return xml(twiml(""));

  if (isOptOut(body)) {
    await db.smsOptOut.upsert({ where: { receptionistId_phone: { receptionistId: r.id, phone: from } }, create: { receptionistId: r.id, phone: from }, update: {} });
    return xml(twiml(""));
  }
  if (isOptIn(body)) {
    await db.smsOptOut.deleteMany({ where: { receptionistId: r.id, phone: from } });
    return xml(twiml(""));
  }

  const owners = new Set([...leadAlertNumbers(r), ...(r.ringFirstNumber ? [r.ringFirstNumber] : [])]);
  // The owner texting their own line: changes, messages and UNDO (src/lib/owner-mode.ts).
  const ownLine = Boolean(r.businessNumber) && toE164(params.To ?? "") === toE164(r.businessNumber!);
  if (ownLine && isClientInbound(r) && !isHandledReply(body) && (await ownerCaller(r, from).catch(() => null))) {
    const reply = await handleOwnerText(r, from, body.slice(0, 1000)).catch((e) => {
      console.error("owner text", e);
      return "Sorry, that didn't go through. Please try again, or use your portal.";
    });
    return xml(twiml(`<Message>${escapeXml(reply.slice(0, 1500))}</Message>`));
  }
  if (owners.has(from)) {
    if (!isHandledReply(body)) return xml(twiml("")); // the owner's own texts aren't forwarded back to them
    const open = await db.callLog.findFirst({ where: { receptionistId: r.id, followUpNeeded: true, followedUpAt: null }, orderBy: { startedAt: "desc" } });
    if (!open) return xml(twiml(`<Message>${escapeXml("No open leads. You're all caught up.")}</Message>`));
    await db.callLog.update({ where: { id: open.id }, data: { followedUpAt: new Date() } });
    return xml(twiml(`<Message>${escapeXml(`Marked ${open.callerName ?? open.callerNumber ?? "the caller"} as handled.`)}</Message>`));
  }

  if (textsCustomers(r)) {
    const { reply, background } = await handleCustomerText(r, from, body);
    if (background) after(background);
    return xml(twiml(reply ? `<Message>${escapeXml(reply)}</Message>` : ""));
  }
  if (!r.ringFirstNumber && !owners.size) return xml(twiml(""));
  return xml(forwardSms([...owners][0]!, params.From ?? "unknown", body));
}
