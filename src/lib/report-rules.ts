// Client call reports (weekly / monthly): periods and totals. Pure; unit tested.
// Reports carry counts only (no caller names, numbers or transcripts): the details stay in the
// client's portal behind their login.

import { isoDate, localClock, localDate, zonedTime, type WeeklyHours } from "./booking";

export type ReportKind = "week" | "month";

export type ReportPeriod = { kind: ReportKind; start: Date; end: Date; label: string; key: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function addDaysLocal(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * The report period `offset` periods from the current one, in the business's time zone:
 * weeks run Monday to Sunday, months are calendar months. offset 0 = this period so far,
 * -1 = the last complete one.
 */
export function periodFor(kind: ReportKind, offset: number, tz: string, now = new Date()): ReportPeriod {
  const today = localDate(now, tz);
  if (kind === "week") {
    const sinceMonday = (today.weekday + 6) % 7;
    const s = addDaysLocal(today.y, today.m, today.d, -sinceMonday + offset * 7);
    const e = addDaysLocal(s.y, s.m, s.d, 7);
    const last = addDaysLocal(s.y, s.m, s.d, 6);
    const label = s.m === last.m ? `${MONTHS[s.m - 1]} ${s.d}–${last.d}, ${last.y}` : `${MONTHS[s.m - 1]} ${s.d} – ${MONTHS[last.m - 1]} ${last.d}, ${last.y}`;
    return { kind, start: zonedTime(s.y, s.m, s.d, 0, tz), end: zonedTime(e.y, e.m, e.d, 0, tz), label, key: `week:${isoDate(s.y, s.m, s.d)}` };
  }
  const first = new Date(Date.UTC(today.y, today.m - 1 + offset, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const next = new Date(Date.UTC(y, m, 1));
  return {
    kind,
    start: zonedTime(y, m, 1, 0, tz),
    end: zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, 0, tz),
    label: `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`,
    key: `month:${isoDate(y, m, 1)}`,
  };
}

export type ReportCall = { startedAt: Date; outcome: string; durationSec: number; followUpNeeded?: boolean; followedUpAt?: Date | null };

export type ReportTotals = {
  calls: number; // real calls (spam excluded)
  spam: number;
  afterHours: number | null; // null when no hours are set
  booked: number;
  messages: number;
  transfers: number;
  answered: number; // questions handled, nothing else needed
  missed: number; // hung up early or couldn't help
  waiting: number; // still need a call back
  minutes: number;
  avgDurationSec: number;
  estValueCents: number | null; // booked × average job value, when known
  busiestDay: string | null;
  busiestHour: string | null; // e.g. "9–10am"
  perDay: { date: string; calls: number }[];
};

function hourLabel(h: number): string {
  const fmt = (x: number) => `${x % 12 || 12}${x < 12 ? "am" : "pm"}`;
  return `${fmt(h)}–${fmt((h + 1) % 24)}`;
}

/** Is a local time inside the weekly hours? */
function inHours(hours: WeeklyHours, weekday: number, minutes: number): boolean {
  return (hours[weekday] ?? []).some(([a, b]) => minutes >= a && minutes < b);
}

export function summarize(calls: ReportCall[], period: ReportPeriod, opts: { tz: string; hours?: WeeklyHours | null; avgJobValueCents?: number | null }): ReportTotals {
  const real = calls.filter((c) => c.outcome !== "SPAM");
  const count = (o: string) => real.filter((c) => c.outcome === o).length;
  const hasHours = Boolean(opts.hours && Object.values(opts.hours).some((r) => r.length));
  const days = new Map<string, number>();
  const byWeekday = new Array(7).fill(0) as number[];
  const byHour = new Array(24).fill(0) as number[];
  let afterHours = 0;
  for (const c of real) {
    const l = localDate(c.startedAt, opts.tz);
    const k = isoDate(l.y, l.m, l.d);
    days.set(k, (days.get(k) ?? 0) + 1);
    const clock = localClock(c.startedAt, opts.tz);
    byWeekday[clock.weekday]!++;
    byHour[Math.floor(clock.minutes / 60)]!++;
    if (hasHours && !inHours(opts.hours!, clock.weekday, clock.minutes)) afterHours++;
  }
  // Every calendar day of the period, so quiet days show as zero. Step through dates, not 24-hour
  // blocks: the week the clocks change has a 23- or 25-hour day.
  const perDay: { date: string; calls: number }[] = [];
  const first = localDate(period.start, opts.tz);
  const last = localDate(new Date(period.end.getTime() - 1), opts.tz);
  const lastKey = isoDate(last.y, last.m, last.d);
  for (let i = 0; i < 32; i++) {
    const d = addDaysLocal(first.y, first.m, first.d, i);
    const k = isoDate(d.y, d.m, d.d);
    perDay.push({ date: k, calls: days.get(k) ?? 0 });
    if (k === lastKey) break;
  }
  const top = (arr: number[]) => {
    const max = Math.max(...arr);
    return max > 0 ? arr.indexOf(max) : -1;
  };
  const seconds = real.reduce((n, c) => n + c.durationSec, 0);
  const booked = count("BOOKED");
  return {
    calls: real.length,
    spam: calls.length - real.length,
    afterHours: hasHours ? afterHours : null,
    booked,
    messages: count("MESSAGE_TAKEN"),
    transfers: count("TRANSFERRED"),
    answered: count("ANSWERED"),
    missed: count("MISSED_OPPORTUNITY"),
    waiting: real.filter((c) => c.followUpNeeded && !c.followedUpAt).length,
    minutes: Math.round(seconds / 60),
    avgDurationSec: real.length ? Math.round(seconds / real.length) : 0,
    estValueCents: opts.avgJobValueCents ? booked * opts.avgJobValueCents : null,
    busiestDay: top(byWeekday) >= 0 ? DAY_NAMES[top(byWeekday)]! : null,
    busiestHour: top(byHour) >= 0 ? hourLabel(top(byHour)) : null,
    perDay,
  };
}

/** "+8" / "−3" / "no change" against the previous period (read with "vs last week"). */
export function delta(current: number, previous: number): string {
  const d = current - previous;
  return d === 0 ? "no change" : d > 0 ? `+${d}` : `−${Math.abs(d)}`;
}

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

/** Plain-text email body: totals only, with a link to the portal for details. */
export function reportEmail(o: { businessName: string; receptionistName: string; period: ReportPeriod; cur: ReportTotals; prev: ReportTotals; avgJobValueCents?: number | null; portalUrl: string; company: string }): { subject: string; body: string } {
  const { cur, prev } = o;
  const word = o.period.kind === "week" ? "week" : "month";
  const lines = [
    `Here's what ${o.receptionistName} handled for ${o.businessName} ${o.period.kind === "week" ? "the week of" : "in"} ${o.period.label}.`,
    "",
    `Calls answered: ${cur.calls} (${delta(cur.calls, prev.calls)} vs last ${word})`,
    ...(cur.afterHours != null ? [`After hours: ${cur.afterHours} (calls that would have gone to voicemail)`] : []),
    `Appointments booked: ${cur.booked} (${delta(cur.booked, prev.booked)})`,
    `Messages taken: ${cur.messages}`,
    `Transferred to you: ${cur.transfers}`,
    `Questions answered: ${cur.answered}`,
    ...(cur.estValueCents != null && cur.booked ? [`Estimated value of booked jobs: ${money(cur.estValueCents)} (${cur.booked} × ${money(o.avgJobValueCents ?? 0)} average job)`] : []),
    ...(cur.waiting ? [``, `${cur.waiting} caller${cur.waiting === 1 ? " is" : "s are"} still waiting for a call back.`] : []),
    ...(cur.busiestDay ? [``, `Busiest: ${cur.busiestDay}s, ${cur.busiestHour}.`] : []),
    ...(cur.spam ? [`Spam and robocalls screened out: ${cur.spam}`] : []),
    "",
    `See each call and the full report: ${o.portalUrl}`,
    "",
    `You get this ${word}ly report because it's turned on in your portal (Settings → Reports). Change or stop it there any time.`,
    `— ${o.company}`,
  ];
  return { subject: `${o.businessName}: ${cur.calls} calls answered, ${cur.booked} booked (${o.period.label})`, body: lines.join("\n") };
}
