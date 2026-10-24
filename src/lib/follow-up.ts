import "server-only";
import type { CallLog, Receptionist } from "@prisma/client";
import { db } from "./db";
import { callerFollowUp, claudeConfigured } from "./claude";
import { sendPlainEmail } from "./outreach";
import { sendSms } from "./twilio";

// Summaries the receptionist sends a caller after a booking and/or a call, by text or email.
// Settings live on the receptionist (followUpOn, followUpChannel) and are editable in the CRM
// and the client portal. Every message is logged in FollowUpMessage, which also de-duplicates:
// a call that already produced a booking confirmation doesn't get a second summary.

import { followUpEnabled, pickChannel, type Channel } from "./follow-up-rules";

export { followUpEnabled, pickChannel, type Channel };

export async function sendFollowUp(
  r: Pick<Receptionist, "id" | "businessName" | "businessNumber">,
  msg: { kind: "booking" | "call"; channel: Channel; to: string; subject: string; body: string; conversationId?: string | null },
): Promise<boolean> {
  let error: string | null = null;
  try {
    if (msg.channel === "sms") await sendSms(msg.to, msg.body, r.businessNumber); // from the client's own line when they have one
    else await sendPlainEmail({ to: msg.to, subject: msg.subject, body: msg.body, fromName: r.businessName });
  } catch (e) {
    error = (e as Error).message.slice(0, 500);
    console.error(`follow-up ${msg.channel} failed`, e);
  }
  await db.followUpMessage.create({
    data: { receptionistId: r.id, conversationId: msg.conversationId ?? null, kind: msg.kind, channel: msg.channel, to: msg.to, subject: msg.channel === "email" ? msg.subject : null, body: msg.body, status: error ? "FAILED" : "SENT", error },
  });
  return !error;
}

/**
 * After a call is logged: send the caller a summary if this receptionist does call follow-ups and
 * the caller asked for one. Skips spam, empty calls, calls older than two hours (so a backfill sync
 * never texts old callers) and calls that already got a booking confirmation.
 */
export async function sendCallFollowUp(r: Receptionist, call: CallLog, collected: Record<string, { value?: unknown }>) {
  if (!followUpEnabled(r, "call") || call.outcome === "SPAM" || !call.transcript.trim()) return;
  if (Date.now() - call.startedAt.getTime() > 2 * 3600_000) return;
  if (await db.followUpMessage.findFirst({ where: { receptionistId: r.id, conversationId: call.externalId } })) return;

  const val = (k: string) => {
    const v = collected[k]?.value;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const email = val("caller_email")?.includes("@") ? val("caller_email") : null;
  const phone = val("callback_number") ?? call.callerNumber;
  const channel = pickChannel(r.followUpChannel, val("summary_delivery"), phone, email);
  if (!channel) return;

  const content = claudeConfigured()
    ? await callerFollowUp(r.businessName, call.transcript, channel).catch(() => null)
    : null;
  const body = content?.body ?? `Thanks for calling ${r.businessName}. ${call.summary}`.slice(0, channel === "sms" ? 320 : 4000);
  await sendFollowUp(r, { kind: "call", channel, to: channel === "sms" ? phone! : email!, subject: content?.subject ?? `Your call with ${r.businessName}`, body, conversationId: call.externalId });
}
