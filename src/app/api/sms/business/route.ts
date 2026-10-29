import { db } from "@/lib/db";
import { forwardSms, twiml, toE164, escapeXml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { isHandledReply, isOptIn, isOptOut } from "@/lib/follow-up-rules";
import { leadAlertNumbers } from "@/lib/follow-up";

// Texts to a business line:
// - STOP / START from anyone: recorded so the line never texts that number again (Twilio also
//   handles the carrier reply itself, so we answer with nothing).
// - "1" (or "done") from the owner: marks their latest open lead handled.
// - Anything else from a caller: forwarded to the owner's cell.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const r = await db.receptionist.findUnique({ where: { businessNumber: params.To ?? "" } });
  const body = params.Body ?? "";
  const from = toE164(params.From ?? "");
  if (!r || !body || !from) return xml(twiml(""));

  if (isOptOut(body)) {
    await db.smsOptOut.upsert({ where: { receptionistId_phone: { receptionistId: r.id, phone: from } }, create: { receptionistId: r.id, phone: from }, update: {} });
    return xml(twiml(""));
  }
  if (isOptIn(body)) {
    await db.smsOptOut.deleteMany({ where: { receptionistId: r.id, phone: from } });
    return xml(twiml(""));
  }

  const owners = new Set([...leadAlertNumbers(r), ...(r.ringFirstNumber ? [r.ringFirstNumber] : [])]);
  if (owners.has(from)) {
    if (!isHandledReply(body)) return xml(twiml("")); // the owner's own texts aren't forwarded back to them
    const open = await db.callLog.findFirst({ where: { receptionistId: r.id, followUpNeeded: true, followedUpAt: null }, orderBy: { startedAt: "desc" } });
    if (!open) return xml(twiml(`<Message>${escapeXml("No open leads. You're all caught up.")}</Message>`));
    await db.callLog.update({ where: { id: open.id }, data: { followedUpAt: new Date() } });
    return xml(twiml(`<Message>${escapeXml(`Marked ${open.callerName ?? open.callerNumber ?? "the caller"} as handled.`)}</Message>`));
  }

  if (!r.ringFirstNumber && !owners.size) return xml(twiml(""));
  return xml(forwardSms([...owners][0]!, params.From ?? "unknown", body));
}
