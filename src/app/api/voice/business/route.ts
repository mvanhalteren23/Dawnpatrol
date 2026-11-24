import { shouldRingFirst, toAgent } from "@/lib/business-line";
import { ringFirst } from "@/lib/twilio";
import { ownerCaller } from "@/lib/owner-mode";
import { screenCall } from "@/lib/call-guard";
import { receptionistByNumber } from "@/lib/answer-path";
import { ANSWER_BUDGET_MS, withBudget } from "@/lib/answer-path-rules";
import { appBase, twilioParams, xml } from "@/lib/twilio-request";

export const preferredRegion = "iad1"; // next to the database (Neon us-east-2) and Twilio's US edge

// Voice webhook for every business line: ring the owner's cell first (with screening), or go
// straight to the receptionist outside hours / when ringing is off.
// The owner check, the call protections and the caller's history run at the same time, so the
// caller isn't kept waiting on one lookup after another.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const to = params.To ?? "";
  const from = params.From ?? "";
  const callSid = params.CallSid ?? "";
  const r = await receptionistByNumber(to);
  if (!r) return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`);

  const ownerP = ownerCaller(r, from).catch(() => null);
  const screenP = screenCall({ line: to, from, callSid, limits: r, r }).catch(() => null);
  // Started now so it's ready if the call goes to the agent; dropped if it's slow.
  const memoryP = import("@/lib/caller-memory").then((m) => withBudget(m.callerMemory(r, from), ANSWER_BUDGET_MS, "")).catch(() => "");

  // The owner calling their own line goes straight to the agent (owner mode), never to their own cell.
  const owner = await ownerP;
  if (owner) return xml(await toAgent(r, from, to, callSid, { owner, callerContext: "" }));
  // Call protections: block list, the line's daily cutoff, calls at once, per-caller limits.
  const screened = await screenP;
  if (screened) return xml(screened);
  if (!shouldRingFirst(r)) return xml(await toAgent(r, from, to, callSid, { owner: null, callerContext: await memoryP }));
  return xml(
    ringFirst({
      cell: r.ringFirstNumber!,
      seconds: r.ringSeconds,
      // Show the real caller on the owner's phone (allowed for forwarded inbound calls).
      // Withheld/anonymous callers don't have a valid number to show, so use the business line.
      callerId: /^\+[1-9]\d{7,14}$/.test(from) ? from : to,
      screenUrl: `${appBase()}/api/voice/business/screen?r=${r.id}`,
      action: `${appBase()}/api/voice/business/after?r=${r.id}`,
    }),
  );
}
