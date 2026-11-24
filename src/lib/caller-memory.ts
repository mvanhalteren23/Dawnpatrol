import "server-only";
import { db } from "./db";
import { toE164 } from "./twilio";
import { ANSWER_BUDGET_MS } from "./answer-path-rules";
import { callerContextText, cleanFirstName, matchableNumber } from "./caller-memory-rules";
import { handlingInstruction, MESSAGE_LOOKBACK_DAYS, parseHandling, type KnownCaller } from "./known-caller-rules";

// Returning-caller recognition: before the agent answers, look up what this line's own records say
// about the caller's number (see caller-memory-rules.ts for how it's worded and kept safe). It runs
// while the call connects, so it gives up after ANSWER_BUDGET_MS (0.7 seconds) and the call carries on without it.

const ACTIVE = ["BOOKED", "CONFIRMED", "RESCHEDULE_REQUESTED"];

/** This line's known-callers entry for a number (name, note, how to handle it), or null. */
export async function knownCallerFor(receptionistId: string, fromRaw: string): Promise<KnownCaller | null> {
  const phone = toE164(fromRaw);
  if (!matchableNumber(phone)) return null;
  const row = await db.trustedNumber.findUnique({ where: { receptionistId_phone: { receptionistId, phone } }, select: { firstName: true, label: true, notes: true, handling: true } });
  return row ? { firstName: row.firstName, label: row.label, notes: row.notes, handling: parseHandling(row.handling) } : null;
}

/**
 * What the agent is told about the caller. `known` can be passed in when the webhook already looked
 * it up (it decides whether to ring the owner first). With recognition switched off, only the
 * owner's handling rule for a known number is passed on (no names, history or notes).
 */
export async function callerMemory(r: { id: string; recognizeCallers?: boolean }, fromRaw: string, known?: KnownCaller | null): Promise<string> {
  const phone = toE164(fromRaw);
  if (!matchableNumber(phone)) return "";
  try {
    return await Promise.race([
      (async () => {
        const k = known !== undefined ? known : await knownCallerFor(r.id, phone).catch(() => null);
        if (r.recognizeCallers === false) return k ? handlingInstruction(k.handling) : "";
        return lookup(r.id, phone, k);
      })(),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), ANSWER_BUDGET_MS)),
    ]);
  } catch (err) {
    console.warn("caller memory failed; carrying on without it", err);
    return "";
  }
}

async function lookup(receptionistId: string, phone: string, known: KnownCaller | null): Promise<string> {
  const now = new Date();
  const since = new Date(now.getTime() - MESSAGE_LOOKBACK_DAYS * 86_400_000);
  const [upcoming, previous, calls, last, message] = await Promise.all([
    db.booking.findFirst({ where: { receptionistId, customerPhone: phone, start: { gt: now }, status: { in: ACTIVE } }, orderBy: { start: "asc" }, select: { title: true, start: true, timezone: true, customerName: true } }),
    db.booking.findFirst({ where: { receptionistId, customerPhone: phone, start: { lte: now }, status: { notIn: ["CANCELLED"] } }, orderBy: { start: "desc" }, select: { start: true, customerName: true } }),
    db.callLog.count({ where: { receptionistId, callerNumber: phone, outcome: { not: "SPAM" } } }),
    db.callLog.findFirst({ where: { receptionistId, callerNumber: phone }, orderBy: { startedAt: "desc" }, select: { startedAt: true, outcome: true, callerName: true } }),
    // Their latest message (a call that needed a follow-up), for "did you get my message?"
    db.callLog.findFirst({ where: { receptionistId, callerNumber: phone, startedAt: { gte: since }, OR: [{ followUpNeeded: true }, { outcome: "MESSAGE_TAKEN" }] }, orderBy: { startedAt: "desc" }, select: { startedAt: true, followedUpAt: true } }),
  ]);
  if (last?.outcome === "SPAM" && !known) return ""; // numbers that were spam are treated as new (unless the owner listed them)
  return callerContextText({
    firstName: cleanFirstName(upcoming?.customerName) ?? cleanFirstName(previous?.customerName) ?? cleanFirstName(last?.callerName),
    upcoming: upcoming ? { title: upcoming.title, start: upcoming.start, timezone: upcoming.timezone } : null,
    calls,
    lastCallAt: last?.startedAt ?? null,
    lastOutcome: last?.outcome ?? null,
    lastBookingAt: previous?.start ?? null,
    known,
    openMessage: message ? { at: message.startedAt, followedUpAt: message.followedUpAt } : null,
  }, now);
}
