import { db } from "@/lib/db";
import { twilioParams } from "@/lib/twilio-request";

// Status of the prospect's leg (initiated, ringing, answered, completed…) for the app to follow.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const q = new URL(req.url).searchParams;
  const b = q.get("b") ?? "";
  const k = q.get("k") ?? "";
  if (b && k && params.CallSid) {
    const status = params.CallStatus === "answered" ? "in-progress" : params.CallStatus ?? null;
    await db.dialerBridge.updateMany({ where: { id: b, legKey: k }, data: { legSid: params.CallSid, legStatus: status } });
  }
  return new Response(null, { status: 204 });
}
