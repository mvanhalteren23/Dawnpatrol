import { describe, expect, it } from "vitest";
import { callStats, clientHealth, daysSince, trend, type HealthFacts } from "@/lib/client-health-rules";

const now = new Date("2026-11-15T18:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const call = (days: number, outcome = "ANSWERED", sec = 120) => ({ startedAt: ago(days), durationSec: sec, outcome });

describe("call stats", () => {
  it("buckets by week and month, and keeps spam out of usage", () => {
    const s = callStats([call(0.5, "BOOKED"), call(2, "MESSAGE_TAKEN"), call(3, "SPAM", 600), call(9, "MISSED_OPPORTUNITY"), call(20), call(40, "ANSWERED", 6000)], now, ago(14));
    expect(s.calls7).toBe(2);
    expect(s.callsPrev7).toBe(1);
    expect(s.calls30).toBe(4);
    expect([s.booked30, s.messages30, s.missed30, s.spam30]).toEqual([1, 1, 1, 1]);
    expect(s.minutesMonth).toBe(6); // three 2-minute calls since the month started; spam and older calls excluded
    expect(s.daily).toHaveLength(14);
    expect(s.daily[13]).toBe(1);
    expect(s.daily.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("client health", () => {
  const base: HealthFacts = {
    liveDays: 60, stats: callStats([call(1, "BOOKED"), call(2), call(3), call(8), call(9), call(10)], now, ago(14)), includedMinutes: 200, bookingEnabled: true, lastCallAt: ago(1),
    lineProblems: [], lineWarnings: [], paused: false, subscriptionStatus: "ACTIVE", openQuestions: 0, oldestQuestionDays: null, unhandledLeads: 0, oldestLeadDays: null, lastPortalLoginDays: 3, hasPortalUser: true,
  };
  it("is healthy when the line is used and nothing is waiting", () => {
    expect(clientHealth(base, now)).toEqual({ status: "healthy", reasons: [] });
    expect(clientHealth({ ...base, liveDays: 2 }, now).status).toBe("new");
  });
  it("needs attention for a broken line, a silent line, overdue payment, or ignored callers", () => {
    expect(clientHealth({ ...base, lineProblems: ["The phone number no longer sends calls to this site"] }, now).status).toBe("attention");
    const silent = clientHealth({ ...base, lastCallAt: ago(20), stats: callStats([], now, ago(14)) }, now);
    expect(silent.status).toBe("attention");
    expect(silent.reasons[0]!.text).toContain("No calls for 20 days");
    expect(clientHealth({ ...base, subscriptionStatus: "PAST_DUE" }, now).reasons[0]!.text).toBe("Payment is past due");
    expect(clientHealth({ ...base, openQuestions: 6, oldestQuestionDays: 4 }, now).status).toBe("attention");
    expect(clientHealth({ ...base, unhandledLeads: 4, oldestLeadDays: 5 }, now).status).toBe("attention");
    expect(clientHealth({ ...base, stats: { ...base.stats, minutesMonth: 230 } }, now).reasons[0]!.text).toContain("Over their minutes");
  });
  it("is worth watching for early signs", () => {
    const drop = clientHealth({ ...base, stats: { ...base.stats, calls7: 2, callsPrev7: 10 } }, now);
    expect(drop.status).toBe("watch");
    expect(drop.reasons[0]!.text).toContain("Calls down 80%");
    expect(clientHealth({ ...base, stats: { ...base.stats, minutesMonth: 160 } }, now).reasons[0]!.text).toBe("80% of this month's minutes used");
    expect(clientHealth({ ...base, openQuestions: 3 }, now).status).toBe("watch");
    expect(clientHealth({ ...base, lastPortalLoginDays: null }, now).reasons[0]!.text).toContain("never signed in");
    expect(clientHealth({ ...base, stats: { ...base.stats, calls30: 20, missed30: 10 } }, now).reasons[0]!.text).toContain("50% of callers left");
    expect(clientHealth({ ...base, stats: { ...base.stats, calls30: 20, booked30: 0 } }, now).reasons[0]!.text).toContain("No bookings");
  });
  it("lists the serious reasons first and doesn't nag a brand-new line", () => {
    const h = clientHealth({ ...base, openQuestions: 3, subscriptionStatus: "PAST_DUE" }, now);
    expect(h.reasons.map((r) => r.level)).toEqual(["attention", "watch"]);
    expect(clientHealth({ ...base, liveDays: 3, lastCallAt: null, stats: callStats([], now, ago(3)), lastPortalLoginDays: null }, now).status).toBe("new");
  });
  it("formats trends and ages", () => {
    expect(trend(12, 8)).toBe("+50%");
    expect(trend(4, 8)).toBe("-50%");
    expect(trend(3, 0)).toBe("new");
    expect(trend(0, 0)).toBe("");
    expect(daysSince(ago(5.4), now)).toBe(5);
    expect(daysSince(null, now)).toBeNull();
  });
});
