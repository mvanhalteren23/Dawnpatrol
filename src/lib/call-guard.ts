import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { escapeXml, say, sendSms, toE164, twiml, twilioApi } from "./twilio";
import { appBase } from "./twilio-request";
import {
  callerKey, callerOverLimit, isAnonymous, isCanadaOrUs, lineTripReason, MESSAGES, TRUST_BOOKERS_DAYS, VOICEMAIL_SECONDS, type LineLimits, type RecentCall,
} from "./call-guard-rules";

// Call protections (rules in call-guard-rules.ts). Every check fails open: if Twilio or the
// database can't answer, the call goes through as normal rather than a real customer being lost.

type TwilioCall = { sid: string; from: string; to: string; status: string; start_time: string | null; duration: string | null };

async function listCalls(params: Record<string, string>): Promise<TwilioCall[]> {
  const q = new URLSearchParams({ PageSize: "200", ...params }).toString();
  const res = await twilioApi<{ calls: TwilioCall[] }>(`/Calls.json?${q}`);
  return res.calls ?? [];
}

export async function isBlocked(from: string | null | undefined): Promise<boolean> {
  const key = isAnonymous(from) ? "anonymous" : toE164(from ?? "");
  return Boolean(await db.blockedNumber.findUnique({ where: { phone: key } }).catch(() => null));
}

export async function blockNumber(phone: string, reason: string, by: string | null) {
  const key = isAnonymous(phone) ? "anonymous" : toE164(phone);
  await db.blockedNumber.upsert({ where: { phone: key }, create: { phone: key, reason: reason.slice(0, 300), createdBy: by }, update: { reason: reason.slice(0, 300) } });
  return key;
}

/** 2-minute voicemail: while a line's daily cutoff is tripped, or for a caller over their limit. */
export function voicemailTwiml(r: Pick<Receptionist, "id" | "businessName">, why: "paused" | "limit" = "paused"): string {
  const base = `${appBase()}/api/voice/guard?r=${encodeURIComponent(r.id)}&why=${why}`;
  return twiml(`${say(MESSAGES.voicemail(r.businessName))}<Record maxLength="${VOICEMAIL_SECONDS}" playBeep="true" timeout="8" transcribe="true" transcribeCallback="${escapeXml(`${base}&step=transcript`)}" action="${escapeXml(`${base}&step=done`)}" method="POST"/><Hangup/>`);
}

/**
 * Screen an incoming call before anything costs money. Returns TwiML to answer with instead of
 * the agent, or null to carry on (ring-first or the agent).
 */
export async function screenCall(o: { line: string; from: string; callSid: string; limits: LineLimits; r: Pick<Receptionist, "id" | "businessName" | "guardTrippedAt"> }): Promise<string | null> {
  if (await isBlocked(o.from)) return twiml(`<Reject reason="busy"/>`);
  if (o.r.guardTrippedAt) return voicemailTwiml(o.r);
  try {
    const anonymous = isAnonymous(o.from);
    const trusted = !anonymous && (await isTrusted(o.r.id, o.from));
    const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    const [inProgress, history] = await Promise.all([
      listCalls({ To: o.line, Status: "in-progress" }),
      trusted ? Promise.resolve([] as TwilioCall[]) : anonymous ? listCalls({ To: o.line, "StartTime>": since }) : listCalls({ To: o.line, From: o.from, "StartTime>": since }),
    ]);
    // 5. Calls at the same time on this line.
    const live = inProgress.filter((c) => c.sid !== o.callSid);
    if (live.length >= o.limits.maxConcurrentCalls) {
      const texting = await textBackOnce(o.line, o.from, o.r.businessName);
      return twiml(`${say(MESSAGES.busy(o.r.businessName, texting))}<Hangup/>`);
    }
    // 3. This caller over their allowance in the last 24 hours.
    const theirs = anonymous ? history.filter((c) => isAnonymous(c.from)) : history;
    const recent: RecentCall[] = theirs.map((c) => ({ sid: c.sid, startTime: c.start_time ? new Date(c.start_time) : null, durationSec: Number(c.duration ?? 0) || 0 }));
    const over = trusted ? null : callerOverLimit(recent, { thisSid: o.callSid, limits: o.limits, anonymous });
    if (over) {
      // A real customer never hits a dead end: they can leave a voicemail (cheap; no agent minutes).
      console.warn("call guard: caller over limit", { line: o.line, caller: callerKey(o.from), over });
      return voicemailTwiml(o.r, "limit");
    }
  } catch (err) {
    console.warn("call guard check failed; letting the call through", err);
  }
  return null;
}

/**
 * Never limited: numbers on the line's trusted list (suppliers, staff, regulars), and anyone who
 * booked with this line in the last 90 days.
 */
export async function isTrusted(receptionistId: string, from: string): Promise<boolean> {
  const phone = toE164(from);
  const since = new Date(Date.now() - TRUST_BOOKERS_DAYS * 86400_000);
  const [listed, booked, bookedCall] = await Promise.all([
    db.trustedNumber.findUnique({ where: { receptionistId_phone: { receptionistId, phone } } }),
    db.booking.findFirst({ where: { receptionistId, customerPhone: phone, start: { gte: since } }, select: { id: true } }),
    db.callLog.findFirst({ where: { receptionistId, callerNumber: phone, outcome: "BOOKED", startedAt: { gte: since } }, select: { id: true } }),
  ]);
  return Boolean(listed || booked || bookedCall);
}

export async function trustNumber(receptionistId: string, phone: string, label: string, by: string | null): Promise<string> {
  const e164 = toE164(phone);
  await db.trustedNumber.upsert({
    where: { receptionistId_phone: { receptionistId, phone: e164 } },
    create: { receptionistId, phone: e164, label: label.slice(0, 80), createdBy: by },
    update: { label: label.slice(0, 80) || undefined },
  });
  return e164;
}

/** One "sorry we missed you" text per caller per line per day, to real Canadian/US numbers only. */
async function textBackOnce(line: string, from: string, business: string): Promise<boolean> {
  if (isAnonymous(from)) return false;
  const to = toE164(from);
  if (!isCanadaOrUs(to)) return false;
  const key = `guard.textback.${line}.${to}`;
  const last = Number((await getSetting(key)) ?? 0);
  if (Date.now() - last < 24 * 3600_000) return false;
  await setSetting(key, String(Date.now()));
  await sendSms(to, MESSAGES.busyText(business), line).catch((e) => console.warn("busy text-back failed", e));
  return true;
}

/** The receptionists whose calls count toward one line's daily cutoff (the demo line covers our line and every demo). */
async function lineMembers(r: Receptionist): Promise<{ owner: Receptionist; ids: string[] }> {
  if (r.bookingAddsToCrm || r.lifecycle === "demo") {
    const house = r.bookingAddsToCrm ? r : await db.receptionist.findFirst({ where: { bookingAddsToCrm: true, agentType: "inbound" } });
    const ids = (await db.receptionist.findMany({ where: { OR: [{ bookingAddsToCrm: true }, { lifecycle: "demo" }] }, select: { id: true } })).map((x) => x.id);
    return { owner: house ?? r, ids };
  }
  return { owner: r, ids: [r.id] };
}

/** After each call: trip the line's daily cutoff if it's running far past normal. */
export async function checkLineVolume(r: Receptionist): Promise<void> {
  if ((r.agentType ?? "inbound") !== "inbound") return;
  const { owner, ids } = await lineMembers(r);
  if (owner.guardTrippedAt) return;
  const now = Date.now();
  const [day, fortnight] = await Promise.all([
    db.callLog.aggregate({ where: { receptionistId: { in: ids }, startedAt: { gte: new Date(now - 24 * 3600_000) }, outcome: { not: "SPAM" } }, _sum: { durationSec: true } }),
    db.callLog.aggregate({ where: { receptionistId: { in: ids }, startedAt: { gte: new Date(now - 15 * 24 * 3600_000), lt: new Date(now - 24 * 3600_000) }, outcome: { not: "SPAM" } }, _sum: { durationSec: true } }),
  ]);
  const reason = lineTripReason({ last24hMinutes: (day._sum.durationSec ?? 0) / 60, usualDailyMinutes: (fortnight._sum.durationSec ?? 0) / 60 / 14, limit: owner.lineDailyMinutes });
  if (!reason) return;
  const tripped = await db.receptionist.updateMany({ where: { id: owner.id, guardTrippedAt: null }, data: { guardTrippedAt: new Date(), guardReason: reason } });
  if (!tripped.count) return;
  const link = `${appBase()}/crm/receptionists/${owner.id}`;
  await alertTeam(`Line paused: ${owner.businessName}`, `${owner.businessName}'s line has switched to 2-minute voicemail: ${reason}. Check the calls, block any abusive numbers, then reset it: ${link}`);
  const { leadAlertNumbers } = await import("./follow-up");
  if (!owner.bookingAddsToCrm) {
    for (const to of leadAlertNumbers(owner)) {
      await sendSms(to, `${owner.businessName}: unusually heavy call volume today, so new calls are going to voicemail for now. Messages are texted to you as usual. Our team has been alerted.`, owner.businessNumber).catch(() => undefined);
    }
  }
}

export async function resetGuard(receptionistId: string) {
  await db.receptionist.update({ where: { id: receptionistId }, data: { guardTrippedAt: null, guardReason: "" } });
}

/** Text the administrators' mobiles and email the support address. */
export async function alertTeam(subject: string, body: string) {
  const admins = await db.user.findMany({ where: { role: "ADMIN", disabled: false, phone: { not: null } }, select: { phone: true } });
  for (const a of admins) await sendSms(a.phone!, `${subject}. ${body}`.slice(0, 600)).catch((e) => console.warn("team alert text failed", e));
  const { supportAddress } = await import("./google");
  const to = await supportAddress().catch(() => null);
  if (to) {
    const { sendPlainEmail } = await import("./outreach");
    await sendPlainEmail({ to, subject, body }).catch((e) => console.warn("team alert email failed", e));
  }
}

// --- 7. Twilio spending alerts -------------------------------------------------

const TRIGGER_NAME = "dawnpatrol-daily-spend";

/** A daily Twilio usage trigger at `amount` US dollars (replaces any earlier one). */
export async function setSpendAlert(amount: number): Promise<void> {
  const existing = await twilioApi<{ usage_triggers: { sid: string; friendly_name: string }[] }>(`/Usage/Triggers.json?PageSize=100`);
  for (const t of existing.usage_triggers ?? []) {
    if (t.friendly_name === TRIGGER_NAME) await twilioApi(`/Usage/Triggers/${t.sid}.json`, { method: "DELETE" });
  }
  if (amount <= 0) {
    await setSetting("twilio.spendAlert", "");
    return;
  }
  await twilioApi("/Usage/Triggers.json", {
    form: { FriendlyName: TRIGGER_NAME, UsageCategory: "totalprice", TriggerBy: "price", TriggerValue: String(amount), Recurring: "daily", CallbackUrl: `${appBase()}/api/twilio/usage-alert`, CallbackMethod: "POST" },
  });
  await setSetting("twilio.spendAlert", String(amount));
}

export async function spendAlertAmount(): Promise<number | null> {
  const v = Number((await getSetting("twilio.spendAlert")) ?? "");
  return v > 0 ? v : null;
}
