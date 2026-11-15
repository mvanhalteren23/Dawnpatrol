import { say, twiml } from "@/lib/twilio";
import { appBase, twilioParams, xml } from "@/lib/twilio-request";

// The rep answered our call to their mobile. Pressing 1 proves it's them, not their voicemail.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const b = new URL(req.url).searchParams.get("b") ?? "";
  if (!/^[a-z0-9]{10,40}$/.test(b)) return xml(twiml("<Hangup/>"));
  return xml(
    twiml(
      `<Gather numDigits="1" timeout="10" action="${appBase()}/api/voice/bridge/ready?b=${b}" method="POST">${say("Head Above dialer. Press 1 to start calling.")}</Gather>${say("No key pressed. Goodbye.")}<Hangup/>`,
    ),
  );
}
