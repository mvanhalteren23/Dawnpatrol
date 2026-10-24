import { db } from "@/lib/db";
import { shouldRingFirst, toAgent } from "@/lib/business-line";
import { ringFirst } from "@/lib/twilio";
import { appBase, twilioParams, xml } from "@/lib/twilio-request";

// Voice webhook for every business line: ring the owner's cell first (with screening), or go
// straight to the receptionist outside hours / when ringing is off.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const to = params.To ?? "";
  const from = params.From ?? "";
  const r = await db.receptionist.findUnique({ where: { businessNumber: to } });
  if (!r) return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`);

  if (!shouldRingFirst(r)) return xml(await toAgent(r, from, to));
  return xml(
    ringFirst({
      cell: r.ringFirstNumber!,
      seconds: r.ringSeconds,
      // Show the real caller on the owner's phone (allowed for forwarded inbound calls).
      callerId: from || to,
      screenUrl: `${appBase()}/api/voice/business/screen?r=${r.id}`,
      action: `${appBase()}/api/voice/business/after?r=${r.id}`,
    }),
  );
}
