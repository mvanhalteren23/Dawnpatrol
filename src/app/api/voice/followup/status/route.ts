import { after } from "next/server";
import { handleFollowupStatus, retryAfterWait } from "@/lib/followup";
import { twilioParams } from "@/lib/twilio-request";

export const maxDuration = 300; // a retry waits a couple of minutes before dialling again

// A follow-up call ended: retry, or text the lead and tell the owner.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const leadId = new URL(req.url).searchParams.get("lead");
  if (!leadId) return new Response(null, { status: 204 });
  const { retry } = await handleFollowupStatus(leadId, params);
  if (retry) after(() => retryAfterWait(leadId));
  return new Response(null, { status: 204 });
}
