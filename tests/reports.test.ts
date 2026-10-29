import { describe, expect, it } from "vitest";
import { delta, periodFor, reportEmail, summarize } from "@/lib/report-rules";
import { parseWeeklyHours } from "@/lib/booking";

const tz = "America/Vancouver";
const now = new Date("2026-10-28T18:00:00Z"); // Wednesday Oct 28, 11am Vancouver

describe("report periods", () => {
  it("weeks run Monday to Sunday in the business's time zone", () => {
    const last = periodFor("week", -1, tz, now);
    expect(last.label).toBe("Oct 19–25, 2026");
    expect(last.start.toISOString()).toBe("2026-10-19T07:00:00.000Z"); // midnight PDT
    expect(last.end.toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
  it("months are calendar months, across the DST change", () => {
    const nov = periodFor("month", 1, tz, now);
    expect(nov.label).toBe("November 2026");
    expect(nov.start.toISOString()).toBe("2026-11-01T07:00:00.000Z"); // still PDT at midnight Nov 1
    expect(nov.end.toISOString()).toBe("2026-12-01T08:00:00.000Z"); // PST
    expect(periodFor("month", -1, tz, now).key).toBe("month:2026-09-01");
  });
});

describe("summarize", () => {
  const period = periodFor("week", -1, tz, now);
  const at = (iso: string) => new Date(iso);
  const calls = [
    { startedAt: at("2026-10-19T17:00:00Z"), outcome: "BOOKED", durationSec: 120 }, // Mon 10am
    { startedAt: at("2026-10-20T04:00:00Z"), outcome: "MESSAGE_TAKEN", durationSec: 60, followUpNeeded: true, followedUpAt: null }, // Mon 9pm
    { startedAt: at("2026-10-24T18:00:00Z"), outcome: "BOOKED", durationSec: 180 }, // Sat 11am
    { startedAt: at("2026-10-21T17:30:00Z"), outcome: "SPAM", durationSec: 10 },
  ];
  const t = summarize(calls, period, { tz, hours: parseWeeklyHours("Mon-Fri 09:00-17:00"), avgJobValueCents: 45000 });
  it("counts outcomes and leaves spam out of the totals", () => {
    expect(t.calls).toBe(3);
    expect(t.spam).toBe(1);
    expect(t.booked).toBe(2);
    expect(t.messages).toBe(1);
    expect(t.waiting).toBe(1);
    expect(t.estValueCents).toBe(90000);
  });
  it("counts calls outside business hours as after hours", () => {
    expect(t.afterHours).toBe(2); // Monday 9pm and Saturday
    expect(summarize(calls, period, { tz }).afterHours).toBeNull();
  });
  it("lists every day of the week, quiet ones as zero", () => {
    expect(t.perDay).toHaveLength(7);
    expect(t.perDay[0]).toEqual({ date: "2026-10-19", calls: 2 });
    expect(t.busiestDay).toBe("Monday");
  });
  it("writes an email with totals only", () => {
    const e = reportEmail({ businessName: "DeRosa Automotive", receptionistName: "Ava", period, cur: t, prev: { ...t, calls: 1, booked: 2 }, avgJobValueCents: 45000, portalUrl: "https://x/portal/reports", company: "Head Above Digital" });
    expect(e.subject).toBe("DeRosa Automotive: 3 calls answered, 2 booked (Oct 19–25, 2026)");
    expect(e.body).toContain("Calls answered: 3 (+2 vs last week)");
    expect(e.body).toContain("$900");
    expect(delta(2, 5)).toBe("−3");
  });
});

describe("report periods across the clock change", () => {
  it("has exactly 7 days in the week clocks fall back (Nov 1, 2026) and 30 in November", () => {
    const week = periodFor("week", 0, tz, new Date("2026-10-28T18:00:00Z")); // Oct 26 – Nov 1
    expect(summarize([], week, { tz }).perDay.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    const nov = periodFor("month", 1, tz, new Date("2026-10-28T18:00:00Z"));
    const days = summarize([], nov, { tz }).perDay;
    expect(days).toHaveLength(30);
    expect(days.at(-1)!.date).toBe("2026-11-30");
  });
  it("reads naturally when nothing changed", () => {
    expect(delta(4, 4)).toBe("no change");
  });
});
