import "server-only";
import bcrypt from "bcryptjs";
import type { CallLog, KnownCaller, Receptionist } from "@prisma/client";
import { db } from "./db";
import { deleteSetting, getSetting, setSetting } from "./settings";
import { samePhone, sendSms, toE164 } from "./twilio";
import { appBase } from "./twilio-request";
import { localHour } from "./customer-text-rules";
import { isoDate, localDate } from "./booking";
import {
  afterWrongPin, assistantEntitled, assistantTierLive, BASE_CATEGORIES, supplierQuestion, CATEGORY_LABELS, cleanLabel, digestDue, digestText, DIGEST_MAX, isCategory, keypadDigits, labelQuestion, parseDigestReply, parseRoutingRules,
  pinLocked, pinProblem, PENDING_TO_CHECKIN_HOURS, PIN_OK_MINUTES, prettyPhone, routeFor, routingContext, suggestedCategory, transferTarget, type Category, type RouteAction,
} from "./assistant-rules";

// Caller routing for every receptionist, and the Assistant tier (rules and wording in assistant-rules.ts):
//   - every receptionist: urgent transfers, and suppliers/deliveries from the owner's list (or
//     spotted on calls and confirmed on a check-in call) routed the owner's way,
//   - who has the Assistant tier (assistantEnabled; in development, off in production), and
//     owner controls (ownerControlsEnabled: Assistant lines, and Grace for the team's admins),
//   - Assistant: every kind of caller, the evening digest, owner changes by phone/text, the PIN.
//   - the caller directory: noting non-customer callers after calls, the evening digest text and
//     the owner's reply, and handing still-unlabelled callers to the next check-in call,
//   - routing at call start ({{caller_routing}}) and the transfer_call tool,
//   - the owner's keypad PIN.

type R = Receptionist;
const E164 = /^\+[1-9]\d{9,14}$/;

/** Does this line have the Assistant features right now? (Never in production while it's in development.) */
export async function assistantEnabled(r: Pick<R, "accountId" | "lifecycle" | "bookingAddsToCrm" | "assistantOverride">): Promise<boolean> {
  const tierLive = assistantTierLive();
  if (!tierLive || r.bookingAddsToCrm) return false; // our own line is a receptionist (owner controls are separate)
  const quick = { tierLive, lifecycle: r.lifecycle, assistantOverride: r.assistantOverride, planTier: null, subscriptionStatus: null };
  // The override and demos don't depend on the plan: no query needed.
  if (r.assistantOverride === "on" || r.assistantOverride === "off" || r.lifecycle === "demo") return assistantEntitled(quick);
  const sub = await db.subscription.findUnique({ where: { accountId: r.accountId }, select: { status: true, plan: { select: { tier: true } } } });
  return assistantEntitled({ ...quick, planTier: sub?.plan?.tier ?? null, subscriptionStatus: sub?.status ?? null });
}

/**
 * The account's plan or subscription changed: re-sync its agents, so Assistant features (prompt
 * sections and tools) are added or removed to match. Best effort, one agent at a time.
 */
export async function refreshAssistantAgents(accountId: string): Promise<void> {
  const rs = await db.receptionist.findMany({ where: { accountId, elevenLabsAgentId: { not: null }, lifecycle: { not: "expired" } }, select: { id: true } });
  if (!rs.length) return;
  const { markDirty, syncReceptionist } = await import("./elevenlabs");
  for (const r of rs) {
    await markDirty(r.id);
    await syncReceptionist(r.id).catch((e) => console.error("assistant tier re-sync", r.id, e));
  }
}

/**
 * Can the owner run this line by phone or text (changes, PIN, feedback, messages)? Assistant lines,
 * and our own line (Grace), whose owners are the team's admins: their "super admin" dial-in.
 */
export async function ownerControlsEnabled(r: Pick<R, "accountId" | "lifecycle" | "bookingAddsToCrm" | "assistantOverride" | "agentType">): Promise<boolean> {
  return isHouseLine(r) || assistantEnabled(r);
}

/** Our own line (Grace): the receptionist that adds bookings to the CRM. */
export function isHouseLine(r: Pick<R, "bookingAddsToCrm" | "agentType">): boolean {
  return r.bookingAddsToCrm && r.agentType === "inbound";
}

/** The number a line answers and texts from: its business line, or for Grace our main (demo) number. */
export function lineNumber(r: Pick<R, "businessNumber" | "bookingAddsToCrm" | "agentType">): string | null {
  if (r.businessNumber) return r.businessNumber;
  return isHouseLine(r) && process.env.TWILIO_DEMO_NUMBER ? toE164(process.env.TWILIO_DEMO_NUMBER) : null;
}

/** The owner's number for texts and calls: check-in number, ring-first cell, transfer number, then the account's. */
export function ownerNumber(r: Pick<R, "checkinPhone" | "ringFirstNumber" | "escalationPhone">, accountPhone?: string | null): string | null {
  const p = r.checkinPhone || r.ringFirstNumber || r.escalationPhone || accountPhone;
  if (!p) return null;
  const e = toE164(p);
  return E164.test(e) ? e : null;
}

function transferFallback(r: Pick<R, "ringFirstNumber" | "escalationPhone">): string | null {
  const p = r.ringFirstNumber || r.escalationPhone;
  return p ? toE164(p) : null;
}

// --- Routing ---------------------------------------------------------------------------------

/** What the directory and the line's rules say about a caller's number. */
/**
 * What the directory and the line's rules say about a caller's number. Without the Assistant tier
 * (`full` false) only suppliers and deliveries are routed; anyone else is a normal caller.
 */
export async function callerRouting(r: R, from: string, full?: boolean): Promise<{ caller: KnownCaller | null; route: { action: RouteAction; to: string | null }; context: string }> {
  const phone = toE164(from || "");
  const all = full ?? (await assistantEnabled(r));
  const found = E164.test(phone) ? await db.knownCaller.findUnique({ where: { receptionistId_phone: { receptionistId: r.id, phone } } }) : null;
  const caller = found && (all || BASE_CATEGORIES.includes(found.category as Category)) ? found : null;
  const route = routeFor(caller, parseRoutingRules(r.routingRules), transferFallback(r));
  return { caller, route, context: routingContext(caller, route) };
}

/**
 * {{caller_routing}} for a call that's starting: empty unless the number is in the line's directory
 * (suppliers and deliveries; every kind of caller on the Assistant tier). Gives up after 1.2
 * seconds (the call carries on without it).
 */
export async function routingForCall(r: R, from: string, opts: { transferFailed?: boolean } = {}): Promise<string> {
  if (opts.transferFailed) return "The caller was just put through to the owner and nobody answered. Apologise briefly, take a message, and say they'll get a call back. Don't try to put them through again.";
  try {
    const run = (async () => (await callerRouting(r, from)).context)();
    return await Promise.race([run, new Promise<string>((ok) => setTimeout(() => ok(""), 1200))]);
  } catch (err) {
    console.warn("caller routing failed; carrying on without it", err);
    return "";
  }
}

/**
 * transfer_call: put the live call through, to where the owner's rules say (or, for an urgent
 * caller, the line's transfer number). The destination comes from our records, never the agent.
 */
export async function transferCall(r: R, callSid: string, urgent: boolean): Promise<{ message: string; redirect?: string }> {
  const { liveCaller } = await import("./owner-mode");
  const from = await liveCaller(callSid, lineNumber(r));
  if (!from) return { message: "Putting callers through isn't possible on this call. Take a message instead, and say they'll get a call back." };
  const { route } = await callerRouting(r, from);
  const to = transferTarget({ route, urgent, escalationPhone: r.escalationPhone ? toE164(r.escalationPhone) : null });
  if (!to || samePhone(to, from)) return { message: "There's nobody set up to put this caller through to. Take a message instead, and say they'll get a call back." };
  await setSetting(`transfer.${callSid}`, JSON.stringify({ to, at: Date.now() }));
  return { message: "Tell the caller you're putting them through now, in one short sentence, then stop talking.", redirect: `${appBase()}/api/voice/transfer?r=${encodeURIComponent(r.id)}` };
}

/** The number a transfer for this call should ring (set by transferCall a moment ago). */
export async function pendingTransfer(callSid: string): Promise<string | null> {
  const raw = await getSetting(`transfer.${callSid}`);
  if (!raw) return null;
  await deleteSetting(`transfer.${callSid}`);
  try {
    const { to, at } = JSON.parse(raw) as { to: string; at: number };
    return Date.now() - at < 5 * 60_000 && E164.test(to) ? to : null;
  } catch {
    return null;
  }
}

// --- The caller directory --------------------------------------------------------------------

/**
 * After a call: callers who don't sound like customers (or whom the agent couldn't place) go on
 * the list for the owner's evening text. Known numbers just get their last call updated.
 */
export async function noteCaller(r: R, call: CallLog, collected: Record<string, { value?: unknown }>): Promise<void> {
  if (!call.callerNumber || call.outcome === "SPAM") return;
  const phone = toE164(call.callerNumber);
  if (!E164.test(phone)) return;
  const note = (call.summary || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const company = typeof collected.caller_company?.value === "string" ? cleanLabel(collected.caller_company.value) : "";
  const name = cleanLabel(call.callerName);
  const existing = await db.knownCaller.findUnique({ where: { receptionistId_phone: { receptionistId: r.id, phone } } });
  if (existing) {
    await db.knownCaller.update({
      where: { id: existing.id },
      data: { lastCallId: call.id, lastCallAt: call.startedAt, ...(existing.status === "PENDING" ? { note, name: existing.name || name, company: existing.company || company } : {}) },
    });
    return;
  }
  const guess = suggestedCategory(collected.caller_kind?.value);
  if (guess === null) return; // a customer (or spam): nothing to ask
  if (!(await assistantEnabled(r))) {
    // A receptionist without the Assistant tier: only callers who sounded like a supplier or a
    // delivery, asked about on the owner's next check-in call (no evening text).
    if (guess !== "SUPPLIER") return;
    const created = await db.knownCaller.create({ data: { receptionistId: r.id, phone, name, company, suggested: guess, note, lastCallId: call.id, lastCallAt: call.startedAt, askedAt: new Date(), source: "call" } });
    if (r.checkinsOn) await db.openQuestion.create({ data: { receptionistId: r.id, kind: "supplier", question: supplierQuestion(created), key: `supplier:${created.id}` } }).catch(() => undefined);
    return;
  }
  await db.knownCaller.create({ data: { receptionistId: r.id, phone, name, company, suggested: guess, note, lastCallId: call.id, lastCallAt: call.startedAt, source: "call" } });
}

/** File a caller under a category (or dismiss them). Closes any check-in question about them. */
export async function labelKnownCaller(id: string, label: Category | "DISMISS", by: string, source: string): Promise<void> {
  await db.knownCaller.update({
    where: { id },
    data: label === "DISMISS" ? { status: "DISMISSED", labelledBy: by, labelledAt: new Date() } : { category: label, status: "LABELLED", labelledBy: by, labelledAt: new Date(), source },
  });
  await db.openQuestion.updateMany({ where: { key: { in: [`label:${id}`, `supplier:${id}`] }, status: "OPEN" }, data: { status: label === "DISMISS" ? "DISMISSED" : "ANSWERED", answer: label === "DISMISS" ? null : CATEGORY_LABELS[label], answeredBy: by, answeredAt: new Date() } });
}

/** Every 30 minutes in the day (the daytime sweep): the evening digest, and old ones to the check-in queue. */
export async function processLabelDigests(now = new Date()): Promise<{ sent: number; queued: number; errors: string[] }> {
  const out = { sent: 0, queued: 0, errors: [] as string[] };
  const rs = await db.receptionist.findMany({
    where: { labelDigestOn: true, lifecycle: "production", agentType: "inbound", knownCallers: { some: { status: "PENDING" } } },
    include: { account: { select: { phone: true } } },
  });
  for (const r of rs) {
    try {
      if (!(await assistantEnabled(r))) continue;
      out.queued += await pendingToCheckin(r, now);
      const d = localDate(now, r.timezone);
      const today = isoDate(d.y, d.m, d.d);
      const key = `labels.digest.${r.id}`;
      if (!digestDue(localHour(now, r.timezone), today, await getSetting(key))) continue;
      await setSetting(key, today); // once a day, even if this one fails
      const to = ownerNumber(r, r.account.phone);
      const from = lineNumber(r);
      if (!to || !from) continue;
      const items = await db.knownCaller.findMany({ where: { receptionistId: r.id, status: "PENDING", askedAt: null }, orderBy: { lastCallAt: "desc" }, take: DIGEST_MAX });
      if (!items.length) continue;
      await db.$transaction(items.map((it, i) => db.knownCaller.update({ where: { id: it.id }, data: { digestNumber: i + 1, askedAt: now } })));
      await setSetting(`labels.digestIds.${r.id}`, JSON.stringify(items.map((it) => it.id)));
      await sendSms(to, digestText({ businessName: r.businessName, items }), from);
      out.sent++;
    } catch (err) {
      out.errors.push(`${r.id}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return out;
}

/** Callers still unlabelled two days after their digest become questions for the next check-in call. */
async function pendingToCheckin(r: R, now: Date): Promise<number> {
  if (!r.checkinsOn) return 0;
  const stale = await db.knownCaller.findMany({ where: { receptionistId: r.id, status: "PENDING", askedAt: { lt: new Date(now.getTime() - PENDING_TO_CHECKIN_HOURS * 3600_000) } }, take: 5 });
  let n = 0;
  for (const it of stale) {
    const key = `label:${it.id}`;
    const exists = await db.openQuestion.findUnique({ where: { receptionistId_key: { receptionistId: r.id, key } }, select: { id: true } });
    if (exists) continue;
    await db.openQuestion.create({ data: { receptionistId: r.id, kind: "label", question: labelQuestion(it), key } });
    n++;
  }
  return n;
}

/**
 * The owner's reply to the evening digest ("1S 2V", "ALL"), or null if the text isn't one (it's then
 * handled as a normal owner text).
 */
export async function handleDigestReply(r: R, from: string, body: string): Promise<string | null> {
  const raw = await getSetting(`labels.digestIds.${r.id}`);
  if (!raw) return null;
  let ids: string[];
  try {
    ids = JSON.parse(raw) as string[];
  } catch {
    return null;
  }
  const reply = parseDigestReply(body, ids.length);
  if (!reply) return null;
  const items = await db.knownCaller.findMany({ where: { id: { in: ids }, receptionistId: r.id } });
  const chosen = new Map(reply.labels.map((l) => [l.n, l.label]));
  const done: string[] = [];
  for (const [i, id] of ids.entries()) {
    const it = items.find((x) => x.id === id);
    if (!it) continue;
    const label = chosen.get(i + 1) ?? (reply.acceptGuesses && it.status === "PENDING" && isCategory(it.suggested) ? it.suggested : undefined);
    if (!label) continue;
    await labelKnownCaller(it.id, label, `owner text ${prettyPhone(toE164(from))}`, "digest");
    const who = [cleanLabel(it.name), cleanLabel(it.company)].filter(Boolean).join(", ") || prettyPhone(it.phone);
    done.push(label === "DISMISS" ? `${i + 1} skipped` : `${i + 1} ${who}: ${CATEGORY_LABELS[label].toLowerCase()}`);
  }
  if (!done.length) return `Nothing to save. Reply with a number and letter, e.g. "1S", or ALL to accept the guesses.`;
  return `Saved: ${done.join("; ")}. ${r.name} will handle them your way from now on. You can change any of them in your portal.`;
}

// --- The owner's PIN -------------------------------------------------------------------------

/** Set (or with null, remove) the owner's keypad PIN. Returns a problem to show, or null when saved. */
export async function setOwnerPin(receptionistId: string, pin: string | null): Promise<string | null> {
  if (pin !== null) {
    const problem = pinProblem(pin);
    if (problem) return problem;
  }
  await db.receptionist.update({ where: { id: receptionistId }, data: { ownerPinHash: pin === null ? null : await bcrypt.hash(pin, 10), ownerPinFails: 0, ownerPinLockedUntil: null } });
  return null;
}

/** Check digits against the PIN, counting wrong ones (three in a row lock it for a while, and the owner is told). */
export async function checkOwnerPin(receptionistId: string, digits: string, now = new Date()): Promise<"ok" | "wrong" | "locked" | "none"> {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, include: { account: { select: { phone: true } } } });
  if (!r.ownerPinHash) return "none";
  if (pinLocked(r.ownerPinLockedUntil, now)) return "locked";
  if (await bcrypt.compare(keypadDigits(digits), r.ownerPinHash)) {
    if (r.ownerPinFails) await db.receptionist.update({ where: { id: r.id }, data: { ownerPinFails: 0 } });
    return "ok";
  }
  const next = afterWrongPin(r.ownerPinFails, now);
  await db.receptionist.update({ where: { id: r.id }, data: { ownerPinFails: next.fails, ownerPinLockedUntil: next.lockedUntil } });
  if (next.lockedUntil) {
    const to = ownerNumber(r, r.account.phone);
    if (to) await sendSms(to, `${r.businessName}: your owner PIN was entered wrong 3 times, so bigger changes by phone are paused for 15 minutes. If that wasn't you, change your PIN in your portal.`, r.businessNumber).catch((e) => console.warn("PIN lock text", e));
    return "locked";
  }
  return "wrong";
}

/** A PIN verified on this call covers changes on it for a few minutes. */
export async function markPinVerified(callSid: string): Promise<void> {
  await setSetting(`owner.pinok.${callSid}`, String(Date.now()));
}

export async function pinVerifiedOnCall(callSid: string): Promise<boolean> {
  const at = Number((await getSetting(`owner.pinok.${callSid}`)) ?? 0);
  return at > 0 && Date.now() - at < PIN_OK_MINUTES * 60_000;
}
