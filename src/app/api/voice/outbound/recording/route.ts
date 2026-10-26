import { after } from "next/server";
import { attachRecording } from "@/lib/dialer";
import { twilioParams } from "@/lib/twilio-request";

// Recording status callback: attach the recording to the call, then transcribe and summarise it.
export const maxDuration = 300;

export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const q = new URL(req.url).searchParams;
  const callSid = q.get("p") || params.CallSid;
  if (callSid && q.get("a") && params.RecordingSid && params.RecordingStatus !== "failed") {
    after(() =>
      attachRecording({ callSid, accountId: q.get("a")!, contactId: q.get("c") || null, recordingSid: params.RecordingSid!, durationSec: Number(params.RecordingDuration ?? 0) }).catch((e) => console.error("call recording", e)),
    );
  }
  return new Response(null, { status: 204 });
}
