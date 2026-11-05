import { checkinTwiml } from "@/lib/owner-checkin";
import { twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";

// The owner answered the weekly check-in call (after answering-machine detection).
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const id = new URL(req.url).searchParams.get("c");
  if (!id) return xml(twiml("<Hangup/>"));
  return xml(await checkinTwiml(id, params.AnsweredBy ?? "unknown"));
}
