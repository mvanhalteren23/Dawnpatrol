// Owner and team mode (pure; unit tested).
//
// - Team: an admin or rep calling our own line from the mobile on their login gets Grace's team
//   menu (open the demo menu or a named demo).
// - Owner: a client calling or texting their own business line from an owner number (the agent's
//   ring-first / check-in / alert numbers, or a portal login's mobile) can update the agent:
//   closures and hours, calendar blocks, what it tells callers, and hear recent messages.
// Caller ID can be faked, so every change is texted back to the owner with "Reply UNDO".

import { z } from "zod";
import { samePhone } from "./twilio";

export const OWNER_TAG = "owner-update";
export const MAX_CLOSED_DAYS = 60;

/** Owner numbers for an agent, plus the account's portal users' mobiles. */
export function ownerNumbers(r: { ringFirstNumber?: string | null; checkinPhone?: string | null; leadAlertTo?: string | null }, portalPhones: (string | null)[]): string[] {
  const listed = (r.leadAlertTo ?? "").split(/[,;]+/).map((n) => n.trim());
  return [r.ringFirstNumber, r.checkinPhone, ...listed, ...portalPhones].filter((n): n is string => Boolean(n && n.replace(/\D/g, "").length >= 10));
}

export function isOwnerNumber(from: string | null | undefined, numbers: string[]): boolean {
  return Boolean(from) && numbers.some((n) => samePhone(n, from));
}

/** What the AI makes of an owner's request (dates already resolved against today in their timezone). */
export const OwnerPlanSchema = z.object({
  action: z.enum(["closed", "special_hours", "hours", "block", "info", "messages", "unclear"]).describe(
    "closed = closed whole days (holiday, vacation); special_hours = different hours on particular dates; hours = their regular weekly hours change from now on; block = block time in the booking calendar so nothing is booked there; info = change or add something the receptionist tells callers; messages = they want recent messages/calls; unclear = anything else or not enough detail",
  ),
  startDate: z.string().nullable().describe("YYYY-MM-DD"),
  endDate: z.string().nullable().describe("YYYY-MM-DD, same as startDate for one day"),
  startTime: z.string().nullable().describe("HH:MM 24-hour, for block or special_hours; null = whole day"),
  endTime: z.string().nullable().describe("HH:MM 24-hour"),
  title: z.string().describe("Short title, e.g. 'Closed for vacation' or 'Spring special'"),
  content: z.string().describe("What the receptionist should tell callers, in plain words (for closed, special_hours, hours, info); empty for block and messages"),
  confirm: z.string().describe("One short sentence read back to the owner before the change, e.g. 'You're closed Monday November 9 through Sunday November 15, and I'll tell callers you're back on the 16th.'"),
  question: z.string().nullable().describe("When unclear: the one question to ask the owner"),
});
export type OwnerPlan = z.infer<typeof OwnerPlanSchema>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Every date from start to end inclusive (YYYY-MM-DD), at most MAX_CLOSED_DAYS. */
export function datesBetween(start: string, end: string | null): string[] {
  if (!DATE.test(start)) return [];
  const last = end && DATE.test(end) ? end : start;
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${last}T00:00:00Z`);
  while (d <= stop && out.length < MAX_CLOSED_DAYS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Add dates to the closed-dates list; returns the new list and the dates actually added. */
export function addClosedDates(existing: string, dates: string[]): { value: string; added: string[] } {
  const have = new Set(existing.split(/\s+/).filter((x) => DATE.test(x)));
  const added = dates.filter((d) => DATE.test(d) && !have.has(d));
  added.forEach((d) => have.add(d));
  return { value: [...have].sort().join("\n"), added };
}

export function removeClosedDates(existing: string, dates: string[]): string {
  const drop = new Set(dates);
  return existing.split(/\s+/).filter((x) => DATE.test(x) && !drop.has(x)).sort().join("\n");
}

/** Problems with a plan before it's applied (an empty list = fine). */
export function planProblems(p: OwnerPlan, today: string): string[] {
  const problems: string[] = [];
  const needsDates = p.action === "closed" || p.action === "special_hours" || p.action === "block";
  if (needsDates && (!p.startDate || !DATE.test(p.startDate))) problems.push("which date");
  if (needsDates && p.startDate && p.startDate < today) problems.push("a date that isn't in the past");
  if (needsDates && p.endDate && p.startDate && p.endDate < p.startDate) problems.push("an end date after the start date");
  if (p.action === "closed" && p.startDate && datesBetween(p.startDate, p.endDate).length >= MAX_CLOSED_DAYS) problems.push(`a closure shorter than ${MAX_CLOSED_DAYS} days`);
  if (p.action === "block" && (p.startTime || p.endTime) && !(p.startTime && p.endTime && TIME.test(p.startTime) && TIME.test(p.endTime) && p.startTime < p.endTime)) problems.push("a start and end time");
  if ((p.action === "info" || p.action === "hours" || p.action === "special_hours") && !p.content.trim()) problems.push("what to tell callers");
  return problems;
}

/** The knowledge note for a dated change; it switches itself off after its last date. */
export function noteTags(p: OwnerPlan): string {
  const until = p.endDate || p.startDate;
  return until && (p.action === "closed" || p.action === "special_hours") ? `${OWNER_TAG},until:${until}` : OWNER_TAG;
}

/** Notes whose last date has passed (tag "until:YYYY-MM-DD" before today). */
export function expiredNote(tags: string, today: string): boolean {
  const m = /until:(\d{4}-\d{2}-\d{2})/.exec(tags);
  return Boolean(m && m[1]! < today);
}

export function isUndo(body: string): boolean {
  return /^\s*undo\s*[.!]?\s*$/i.test(body);
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** The confirmation text sent after any change. */
export function confirmationText(o: { businessName: string; summary: string; channel: "call" | "text" }): string {
  return `${o.businessName}: ${o.summary}${o.channel === "call" ? " (made on your call just now)" : ""}. Reply UNDO to reverse it. Not you? Reply UNDO and let us know.`;
}
