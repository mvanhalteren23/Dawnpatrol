// Client health (pure; unit tested): turns what we know about a client's line into a status and
// the reasons for it, so the team can see who needs a call before the client notices a problem.

export type HealthStatus = "attention" | "watch" | "healthy" | "new";

export type CallRow = { startedAt: Date; durationSec: number; outcome: string };

export type CallStats = {
  calls7: number;
  callsPrev7: number;
  calls30: number;
  booked30: number;
  messages30: number;
  missed30: number; // ended without a booking or message when the caller wanted something
  spam30: number;
  minutesMonth: number;
  daily: number[]; // calls per day, oldest first, last 14 days
};

const DAY = 86_400_000;

/** Bucket a line's recent calls. Spam is counted separately and never as usage. */
export function callStats(calls: CallRow[], now: Date, monthStart: Date): CallStats {
  const s: CallStats = { calls7: 0, callsPrev7: 0, calls30: 0, booked30: 0, messages30: 0, missed30: 0, spam30: 0, minutesMonth: 0, daily: Array(14).fill(0) };
  let monthSec = 0;
  for (const c of calls) {
    const age = now.getTime() - c.startedAt.getTime();
    if (age < 0) continue;
    const spam = c.outcome === "SPAM";
    if (!spam && c.startedAt >= monthStart) monthSec += c.durationSec;
    if (age >= 30 * DAY) continue;
    if (spam) { s.spam30++; continue; }
    s.calls30++;
    if (c.outcome === "BOOKED") s.booked30++;
    else if (c.outcome === "MESSAGE_TAKEN") s.messages30++;
    else if (c.outcome === "MISSED_OPPORTUNITY") s.missed30++;
    if (age < 7 * DAY) s.calls7++;
    else if (age < 14 * DAY) s.callsPrev7++;
    if (age < 14 * DAY) s.daily[13 - Math.floor(age / DAY)]!++;
  }
  s.minutesMonth = Math.ceil(monthSec / 60);
  return s;
}

export type HealthFacts = {
  liveDays: number; // days since the line went live
  stats: CallStats;
  includedMinutes: number;
  bookingEnabled: boolean;
  lastCallAt: Date | null;
  lineProblems: string[]; // from the daily line check
  lineWarnings: string[];
  paused: boolean;
  subscriptionStatus: string | null;
  openQuestions: number;
  oldestQuestionDays: number | null;
  unhandledLeads: number; // messages and missed bookings the owner hasn't marked handled
  oldestLeadDays: number | null;
  lastPortalLoginDays: number | null; // null = never signed in
  hasPortalUser: boolean;
};

export type Health = { status: HealthStatus; reasons: { level: "attention" | "watch"; text: string }[] };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function clientHealth(f: HealthFacts, now = new Date()): Health {
  const reasons: Health["reasons"] = [];
  const attention = (text: string) => reasons.push({ level: "attention", text });
  const watch = (text: string) => reasons.push({ level: "watch", text });
  const s = f.stats;
  const sinceCall = f.lastCallAt ? Math.floor((now.getTime() - f.lastCallAt.getTime()) / DAY) : null;

  // The line itself.
  for (const p of f.lineProblems) attention(p);
  if (f.paused && !f.lineProblems.some((p) => /paused/i.test(p))) attention("Call protection has paused the line");
  for (const w of f.lineWarnings) watch(w);

  // Paying.
  if (f.subscriptionStatus === "PAST_DUE") attention("Payment is past due");
  else if (f.subscriptionStatus === "CANCELED") attention("Subscription is cancelled");

  // Is the line being used?
  if (f.liveDays >= 14 && (sinceCall === null || sinceCall >= 14)) attention(sinceCall === null ? "No calls since going live: check call forwarding" : `No calls for ${sinceCall} days: check call forwarding`);
  else if (f.liveDays >= 7 && (sinceCall === null || sinceCall >= 7)) watch(sinceCall === null ? "No calls yet" : `No calls for ${sinceCall} days`);
  else if (s.callsPrev7 >= 6 && s.calls7 <= s.callsPrev7 * 0.5) watch(`Calls down ${Math.round((1 - s.calls7 / s.callsPrev7) * 100)}% on last week (${s.calls7} vs ${s.callsPrev7})`);

  // Minutes.
  const share = f.includedMinutes > 0 ? s.minutesMonth / f.includedMinutes : 0;
  if (share >= 1) attention(`Over their minutes: ${s.minutesMonth} of ${f.includedMinutes} (extra minutes are being billed)`);
  else if (share >= 0.75) watch(`${Math.round(share * 100)}% of this month's minutes used`);

  // Is the receptionist answering well?
  if (f.openQuestions >= 5 || (f.oldestQuestionDays ?? 0) >= 14) attention(`${plural(f.openQuestions, "caller question")} unanswered${f.oldestQuestionDays ? `, oldest ${f.oldestQuestionDays} days` : ""}`);
  else if (f.openQuestions >= 3) watch(`${plural(f.openQuestions, "caller question")} waiting for an answer`);
  if (s.calls30 >= 10 && s.missed30 / s.calls30 > 0.4) watch(`${Math.round((s.missed30 / s.calls30) * 100)}% of callers left without a booking or message`);
  if (f.bookingEnabled && s.calls30 >= 15 && s.booked30 === 0) watch("No bookings in 30 days despite steady calls");

  // Is the owner engaged?
  if (f.unhandledLeads >= 3 && (f.oldestLeadDays ?? 0) >= 3) attention(`${plural(f.unhandledLeads, "lead")} not followed up, oldest ${f.oldestLeadDays} days`);
  else if (f.unhandledLeads >= 3) watch(`${plural(f.unhandledLeads, "lead")} not marked handled`);
  if (f.liveDays >= 14) {
    if (!f.hasPortalUser) watch("No portal login set up for the client");
    else if (f.lastPortalLoginDays === null) watch("The client has never signed in to their portal");
    else if (f.lastPortalLoginDays >= 30) watch(`No portal sign-in for ${f.lastPortalLoginDays} days`);
  }

  const status: HealthStatus = reasons.some((r) => r.level === "attention") ? "attention" : reasons.length ? "watch" : f.liveDays < 7 ? "new" : "healthy";
  reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === "attention" ? -1 : 1));
  return { status, reasons };
}

export const STATUS_ORDER: Record<HealthStatus, number> = { attention: 0, watch: 1, new: 2, healthy: 3 };

/** "+25%" / "-40%" / "" when there's nothing to compare. */
export function trend(now: number, before: number): string {
  if (!before) return now ? "new" : "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export function daysSince(d: Date | null | undefined, now = new Date()): number | null {
  return d ? Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY)) : null;
}
