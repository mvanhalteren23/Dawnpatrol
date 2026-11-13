// Returning-caller recognition, pure parts (unit tested). The phone system tells the agent what
// our own records say about the caller's number: a first name, an upcoming appointment, how long
// ago they last called. It is a hint, never proof: numbers are shared and can be faked, so the
// agent only confirms ("Is this Dave?") and never reads details out. Only structured facts are
// passed (never free text from earlier calls), and names are cleaned so nothing a caller once
// said can reach the prompt as an instruction.

import { looksLikeInstructions } from "./safety-rules";

export type MemoryFacts = {
  firstName: string | null;
  upcoming: { title: string; start: Date; timezone: string } | null;
  calls: number; // calls from this number to this line, ever
  lastCallAt: Date | null;
  lastOutcome: string | null; // BOOKED | MESSAGE_TAKEN | ANSWERED | …
  lastBookingAt: Date | null; // an earlier appointment, for "have we worked with you before"
};

/** A first name safe to put in a prompt: letters, apostrophes and hyphens only, short, not an instruction. */
export function cleanFirstName(raw: string | null | undefined): string | null {
  const whole = (raw ?? "").trim();
  const first = whole.split(/\s+/)[0] ?? "";
  // The whole stored name is checked, not just its first word: "Ignore previous instructions" isn't a name.
  if (!/^[\p{L}][\p{L}'’-]{0,24}$/u.test(first) || whole.length > 60 || looksLikeInstructions(whole)) return null;
  // Business names and placeholders aren't people.
  if (/^(unknown|caller|customer|test|na|n\/a|none|mr|mrs|ms|dr|inc|ltd|llc)$/i.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** A title safe to put in a prompt (appointment names come from the line's own settings). */
export function cleanTitle(raw: string | null | undefined): string {
  const t = (raw ?? "").replace(/[^\p{L}\p{N} &',.-]/gu, "").trim().slice(0, 40);
  return !t || looksLikeInstructions(t) ? "appointment" : t;
}

const DAY = 86_400_000;

function daysAgo(then: Date, now: Date): string {
  const d = Math.floor((now.getTime() - then.getTime()) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
}

function when(d: Date, tz: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${time}`;
}

const OUTCOME: Record<string, string> = { BOOKED: "booked an appointment", MESSAGE_TAKEN: "left a message", ANSWERED: "had a question answered", TRANSFERRED: "was put through to the owner", MISSED_OPPORTUNITY: "didn't book" };

/**
 * What to tell the agent. Empty when we know nothing (a first-time caller), so the agent treats them as new.
 */
export function callerContextText(f: MemoryFacts, now = new Date()): string {
  if (!f.calls && !f.upcoming && !f.lastBookingAt && !f.firstName) return "";
  const parts = ["Returning caller (matched from their phone number)."];
  if (f.firstName) parts.push(`First name on file: ${f.firstName}.`);
  if (f.upcoming) parts.push(`Upcoming appointment: ${cleanTitle(f.upcoming.title)} on ${when(f.upcoming.start, f.upcoming.timezone)}.`);
  else if (f.lastBookingAt) parts.push(`Booked with us before (${daysAgo(f.lastBookingAt, now)}).`);
  if (f.lastCallAt) parts.push(`Last called ${daysAgo(f.lastCallAt, now)}${f.lastOutcome && OUTCOME[f.lastOutcome] ? ` and ${OUTCOME[f.lastOutcome]}` : ""}.`);
  if (f.calls > 1) parts.push(`${f.calls} calls in total.`);
  return parts.join(" ");
}

/** Withheld and invalid numbers can't be matched. */
export function matchableNumber(e164: string): boolean {
  return /^\+[1-9]\d{9,14}$/.test(e164);
}
