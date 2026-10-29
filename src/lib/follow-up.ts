import "server-only";
import type { CallLog, Receptionist } from "@prisma/client";
import { db } from "./db";
import { callerFollowUp, aiConfigured } from "./ai";
import { sendPlainEmail } from "./outreach";
import { dialableNumber, sendSms, toE164 } from "./twilio";
import { leadAlertWanted, ownerAlertText } from "./follow-up-rules";
import { getSetting, setSetting } from "./settings";

// Summaries the receptionist sends a caller after a booking and/or a call, by text or email.
// Settings live on the receptionist (followUpOn, followUpChannel) and are editable in the CRM
// and the client portal. Every message is logged in FollowUpMessage, which also de-duplicates:
// a call that already produced a booking confirmation doesn't get a second summary.

import { followUpEnabled, pickChannel, type Channel } from "./follow-up-rules";

export { followUpEnabled, pickChannel, type Channel };

export async function sendFollowUp(
  r: Pick<Receptionist, "id" | "businessName" | "businessNumber" | "googleUserId">,
  msg: { kind: "booking" | "call" | "owner_alert"; channel: Channel; to: string; subject: string; body: string; conversationId?: string | null },
): Promise<boolean> {
  let error: string | null = null;
  // Callers who texted STOP to this line are never texted again (owners can't opt out of their own alerts).
  if (msg.channel === "sms" && msg.kind !== "owner_alert" && (await db.smsOptOut.findUnique({ where: { receptionistId_phone: { receptionistId: r.id, phone: toE164(msg.to) } } }))) {
    await db.followUpMessage.create({ data: { receptionistId: r.id, conversationId: msg.conversationId ?? null, kind: msg.kind, channel: msg.channel, to: msg.to, body: msg.body, status: "SKIPPED", error: "The caller texted STOP" } });
    return false;
  }
  try {
    if (msg.channel === "sms") await sendSms(msg.to, msg.body, r.businessNumber); // from the client's own line when they have one
    else await sendPlainEmail({ to: msg.to, subject: msg.subject, body: msg.body, fromName: r.businessName, as: r.googleUserId });
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

  const content = aiConfigured()
    ? await callerFollowUp(r.businessName, call.transcript, channel).catch(() => null)
    : null;
  const body = content?.body ?? `Thanks for calling ${r.businessName}. ${call.summary}`.slice(0, channel === "sms" ? 320 : 4000);
  await sendFollowUp(r, { kind: "call", channel, to: channel === "sms" ? phone! : email!, subject: content?.subject ?? `Your call with ${r.businessName}`, body, conversationId: call.externalId });
}

/** The numbers that get lead texts: the ones set for alerts, else the ring-first cell. */
export function leadAlertNumbers(r: Pick<Receptionist, "leadAlertTo" | "ringFirstNumber">): string[] {
  const listed = r.leadAlertTo.split(/[,;]+/).map((n) => dialableNumber(n.trim())).filter((n): n is string => Boolean(n));
  if (listed.length) return Array.from(new Set(listed));
  return r.ringFirstNumber ? [r.ringFirstNumber] : [];
}

/**
 * Text the owner when a call needs them: a message to return, a caller who hung up, or (if they
 * want every lead) a booking or transfer. Sent once per call, only for live (not demo) lines and
 * only for calls in the last two hours, so a backfill never texts about old calls.
 */
export async function sendLeadAlert(r: Receptionist, call: CallLog) {
  if (r.demoExtension || !leadAlertWanted(r.leadAlertOn, call.outcome)) return;
  if (Date.now() - call.startedAt.getTime() > 2 * 3600_000) return;
  if (await db.followUpMessage.findFirst({ where: { receptionistId: r.id, conversationId: call.externalId, kind: "owner_alert" } })) return;
  const body = ownerAlertText({ businessName: r.businessName, callerName: call.callerName, callerNumber: call.callerNumber, outcome: call.outcome, summary: call.summary, canReply: Boolean(r.businessNumber) });
  for (const to of leadAlertNumbers(r)) {
    await sendFollowUp(r, { kind: "owner_alert", channel: "sms", to, subject: "", body, conversationId: call.externalId });
  }
}

/**
 * Minutes used this calendar month (in the receptionist's time zone) against the plan, and a
 * one-time alert to the team at 80% so there's time to talk to the client before they run out.
 */
export async function checkMinuteUsage(r: Receptionist, now = new Date()) {
  const { periodFor } = await import("./report-rules");
  const month = periodFor("month", 0, r.timezone, now);
  const [used, account] = await Promise.all([
    db.callLog.aggregate({ where: { receptionistId: r.id, startedAt: { gte: month.start, lt: month.end }, outcome: { not: "SPAM" } }, _sum: { durationSec: true } }),
    db.account.findUnique({ where: { id: r.accountId }, select: { name: true, subscription: { select: { plan: { select: { includedMinutes: true } } } } } }),
  ]);
  const cap = account?.subscription?.plan?.includedMinutes || 200;
  const minutes = Math.ceil((used._sum.durationSec ?? 0) / 60);
  if (minutes < cap * 0.8) return { minutes, cap, alerted: false };
  const key = `minutes.alert.${r.id}.${month.key}`;
  if (await getSetting(key)) return { minutes, cap, alerted: false };
  await setSetting(key, new Date().toISOString());
  const { supportAddress } = await import("./google");
  const to = await supportAddress(); // a billing matter: the support/admin inbox
  if (to) {
    const { sendPlainEmail } = await import("./outreach");
    const { appBase } = await import("./twilio-request");
    await sendPlainEmail({
      to,
      subject: `${account?.name ?? r.businessName} has used ${minutes} of ${cap} minutes this month`,
      body: `${r.name} (${r.businessName}) has used ${minutes} of the ${cap} minutes in their plan for ${month.label} (${Math.round((minutes / cap) * 100)}%).\n\nTalk to them about their call volume before the month runs out.\n\n${appBase()}/crm/accounts/${r.accountId}`,
    }).catch((e) => console.warn("minute alert email", e));
  }
  return { minutes, cap, alerted: true };
}
