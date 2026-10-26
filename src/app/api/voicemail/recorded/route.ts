import { after } from "next/server";
import { saveTwilioRecording } from "@/lib/voicemail";
import { twilioParams } from "@/lib/twilio-request";

// recordingStatusCallback for "Record a voicemail by phone" in Dialer settings.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const name = new URL(req.url).searchParams.get("name") || "My voicemail";
  if (params.RecordingSid && params.RecordingStatus === "completed") {
    after(() => saveTwilioRecording(params.RecordingSid!, name, Number(params.RecordingDuration ?? 0)).catch((e) => console.error("save voicemail", e)));
  }
  return new Response(null, { status: 204 });
}
