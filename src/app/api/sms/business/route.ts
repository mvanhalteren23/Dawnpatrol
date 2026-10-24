import { db } from "@/lib/db";
import { forwardSms, twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// Texts to a business line (including replies to follow-up texts) are forwarded to the owner's cell.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const r = await db.receptionist.findUnique({ where: { businessNumber: params.To ?? "" }, select: { ringFirstNumber: true } });
  if (!r?.ringFirstNumber || !params.Body) return xml(twiml(""));
  return xml(forwardSms(r.ringFirstNumber, params.From ?? "unknown", params.Body));
}
