import "server-only";
import { db } from "./db";
import { toE164 } from "./twilio";
import { callerContextText, cleanFirstName, matchableNumber } from "./caller-memory-rules";

// Returning-caller recognition: before the agent answers, look up what this line's own records say
// about the caller's number (see caller-memory-rules.ts for how it's worded and kept safe). It runs
// while the call connects, so it gives up after 1.5 seconds and the call carries on without it.

const ACTIVE = ["BOOKED", "CONFIRMED", "RESCHEDULE_REQUESTED"];

export async function callerMemory(r: { id: string; recognizeCallers?: boolean }, fromRaw: string): Promise<string> {
  if (r.recognizeCallers === false) return "";
  const phone = toE164(fromRaw);
  if (!matchableNumber(phone)) return "";
  try {
    return await Promise.race([lookup(r.id, phone), new Promise<string>((resolve) => setTimeout(() => resolve(""), 1500))]);
  } catch (err) {
    console.warn("caller memory failed; carrying on without it", err);
    return "";
  }
}

async function lookup(receptionistId: string, phone: string): Promise<string> {
  const now = new Date();
  const [upcoming, previous, calls, last] = await Promise.all([
    db.booking.findFirst({ where: { receptionistId, customerPhone: phone, start: { gt: now }, status: { in: ACTIVE } }, orderBy: { start: "asc" }, select: { title: true, start: true, timezone: true, customerName: true } }),
    db.booking.findFirst({ where: { receptionistId, customerPhone: phone, start: { lte: now }, status: { notIn: ["CANCELLED"] } }, orderBy: { start: "desc" }, select: { start: true, customerName: true } }),
    db.callLog.count({ where: { receptionistId, callerNumber: phone, outcome: { not: "SPAM" } } }),
    db.callLog.findFirst({ where: { receptionistId, callerNumber: phone }, orderBy: { startedAt: "desc" }, select: { startedAt: true, outcome: true, callerName: true } }),
  ]);
  if (last?.outcome === "SPAM") return ""; // numbers that were spam are treated as new
  return callerContextText({
    firstName: cleanFirstName(upcoming?.customerName) ?? cleanFirstName(previous?.customerName) ?? cleanFirstName(last?.callerName),
    upcoming: upcoming ? { title: upcoming.title, start: upcoming.start, timezone: upcoming.timezone } : null,
    calls,
    lastCallAt: last?.startedAt ?? null,
    lastOutcome: last?.outcome ?? null,
    lastBookingAt: previous?.start ?? null,
  }, now);
}
