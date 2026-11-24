import { db } from "@/lib/db";
import { escapeXml, ringFirst, twiml } from "@/lib/twilio";
import { lineNumber, pendingTransfer } from "@/lib/assistant";
import { appBase, twilioParams, xml } from "@/lib/twilio-request";

// The call leaves the agent (transfer_call) and lands here: ring the number the line's routing
// chose, with the same "press 1 to answer" screen as ring-first, so a voicemail can't take it.
// Not answered: /api/voice/transfer/after hands the caller back to the agent to take a message.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const r = await db.receptionist.findUnique({ where: { id: new URL(req.url).searchParams.get("r") ?? "" } });
  const to = params.CallSid ? await pendingTransfer(params.CallSid) : null;
  const line = r ? lineNumber(r) : null;
  if (!r || !line || !to) return xml(twiml(`<Redirect method="POST">${escapeXml(`${appBase()}/api/voice/transfer/after?r=${encodeURIComponent(r?.id ?? "")}`)}</Redirect>`));
  const from = params.From ?? "";
  return xml(
    ringFirst({
      cell: to,
      seconds: 25,
      // Show the real caller (allowed for forwarded inbound calls); withheld callers show the line.
      callerId: /^\+[1-9]\d{7,14}$/.test(from) ? from : line,
      screenUrl: `${appBase()}/api/voice/business/screen?r=${r.id}`,
      action: `${appBase()}/api/voice/transfer/after?r=${r.id}`,
    }),
  );
}
