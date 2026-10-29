import { handleAuditStatus } from "@/lib/call-audit";
import { twilioParams } from "@/lib/twilio-request";

// An audit call ended: answered, voicemail, no answer or busy.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const callId = new URL(req.url).searchParams.get("call");
  if (callId) await handleAuditStatus(callId, params);
  return new Response(null, { status: 204 });
}
