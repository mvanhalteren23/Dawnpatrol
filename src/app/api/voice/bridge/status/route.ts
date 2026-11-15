import { db } from "@/lib/db";
import { endedReason } from "@/lib/dialer-bridge-rules";
import { twilioParams } from "@/lib/twilio-request";

// Status of the call to the rep's own phone. When it ends, the session is over.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const b = new URL(req.url).searchParams.get("b") ?? "";
  const status = params.CallStatus ?? "";
  if (b && ["completed", "busy", "no-answer", "failed", "canceled"].includes(status)) {
    const bridge = await db.dialerBridge.findUnique({ where: { id: b } });
    if (bridge && bridge.state !== "ENDED") {
      await db.dialerBridge.update({ where: { id: b }, data: { state: "ENDED", pending: "", endedReason: endedReason(status, bridge.state !== "CALLING") } });
    }
  }
  return new Response(null, { status: 204 });
}
