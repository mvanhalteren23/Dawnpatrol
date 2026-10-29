import { describe, expect, it } from "vitest";
import { localClock } from "../src/lib/booking";
import { auditCostCents, auditStats, auditStatusFromTwilio, auditTranscript, customScenarios, estimateAuditCost, missedCallBaseline, planAuditCalls, scenariosFor, SHOP_DEFAULTS, type AuditCallResult } from "../src/lib/audit-rules";

const TZ = "America/Vancouver";
// Monday 2026-11-02, 00:00 Vancouver
const START = new Date("2026-11-02T08:00:00Z");
const NOW = new Date("2026-11-01T12:00:00Z");
const keys = scenariosFor("auto_repair", "").map((s) => s.key);
const plan = (o: Partial<Parameters<typeof planAuditCalls>[0]> = {}) =>
  planAuditCalls({ seed: "abc", start: START, days: 7, tz: TZ, shopHours: "Mon-Fri 08:00-17:30", callsPerDay: 3, afterHoursCalls: 3, scenarioKeys: keys, now: NOW, ...o });

describe("planAuditCalls", () => {
  it("plans 3 calls per open day plus the after-hours calls", () => {
    const p = plan();
    expect(p.filter((c) => !c.afterHours)).toHaveLength(15);
    expect(p.filter((c) => c.afterHours)).toHaveLength(3);
  });

  it("puts open-hours calls inside open hours and never calls before 8am or after 8:30pm", () => {
    for (const c of plan()) {
      const { weekday, minutes } = localClock(c.scheduledAt, TZ);
      expect(minutes).toBeGreaterThanOrEqual(8 * 60);
      expect(minutes).toBeLessThanOrEqual(20 * 60 + 30);
      if (!c.afterHours) {
        expect(weekday).toBeGreaterThanOrEqual(1);
        expect(weekday).toBeLessThanOrEqual(5);
        expect(minutes).toBeLessThan(17 * 60 + 30);
      }
    }
  });

  it("includes a closed-day (weekend) call and covers every part of the open day", () => {
    const p = plan();
    expect(p.some((c) => c.window === "Closed day")).toBe(true);
    const windows = new Set(p.filter((c) => !c.afterHours).map((c) => c.window));
    expect(windows).toEqual(new Set(["Opening rush", "Mid-morning", "Lunch", "Afternoon", "Closing rush"]));
  });

  it("is sorted, deterministic for a seed, and rotates scenarios", () => {
    const a = plan();
    expect(a.map((c) => c.scheduledAt.getTime())).toEqual([...a].map((c) => c.scheduledAt.getTime()).sort((x, y) => x - y));
    expect(plan()).toEqual(a);
    expect(new Set(a.slice(0, 10).map((c) => c.scenarioKey)).size).toBe(10);
  });

  it("skips slots already in the past", () => {
    const later = plan({ now: new Date("2026-11-04T00:00:00Z") });
    expect(later.length).toBeLessThan(18);
    expect(later.every((c) => c.scheduledAt.getTime() > new Date("2026-11-04T00:00:00Z").getTime())).toBe(true);
  });
});

describe("scenarios", () => {
  it("puts the team's own questions first", () => {
    const s = scenariosFor("auto_repair", "- Do you do rust repair on trucks?\nshort");
    expect(s[0]!.opening).toBe("Do you do rust repair on trucks?");
    expect(customScenarios("ok")).toHaveLength(0);
  });
});

describe("results", () => {
  it("maps Twilio results", () => {
    expect(auditStatusFromTwilio("completed", "human")).toBe("ANSWERED");
    expect(auditStatusFromTwilio("completed", "machine_start")).toBe("VOICEMAIL");
    expect(auditStatusFromTwilio("no-answer", null)).toBe("NO_ANSWER");
    expect(auditStatusFromTwilio("busy", null)).toBe("BUSY");
    expect(auditStatusFromTwilio("failed", null)).toBe("FAILED");
  });

  const call = (status: string, afterHours = false, window = "Lunch"): AuditCallResult => ({ status, afterHours, window, ringSeconds: status === "ANSWERED" ? 12 : null, durationSec: 120, analysis: status === "ANSWERED" ? { handledScore: 4, questionsAsked: 2, answeredQuestions: 2, offeredAppointment: true, askedForContact: false, putOnHold: false, missedOpportunity: null } : null });

  it("counts missed calls and splits open hours from after hours", () => {
    const s = auditStats([call("ANSWERED"), call("ANSWERED"), call("VOICEMAIL"), call("NO_ANSWER", true, "Evening (closed)"), call("FAILED"), call("PLANNED")]);
    expect(s.placed).toBe(4);
    expect(s.missed).toBe(2);
    expect(s.missedPct).toBe(50);
    expect(s.openHours).toEqual({ placed: 3, answered: 2, missedPct: 33 });
    expect(s.afterHours.missedPct).toBe(100);
    expect(s.avgRingSeconds).toBe(12);
    expect(s.quality.offeredAppointmentPct).toBe(100);
    expect(s.quality.askedForContactPct).toBe(0);
  });

  it("turns miss rates into a monthly revenue estimate", () => {
    const s = auditStats([call("ANSWERED"), call("VOICEMAIL"), call("NO_ANSWER", true)]);
    const b = missedCallBaseline(s, SHOP_DEFAULTS.auto_repair);
    // 72 open-hours calls × 50% + 18 after-hours × 100% = 54 missed a week
    expect(b.missedPerWeek).toBe(54);
    // 54 × 35% new × 50% book = 9.45 jobs/week → ~41/month × $450
    expect(b.lostJobsPerMonth).toBeCloseTo(40.9, 1);
    expect(b.revenueAtRiskPerMonthCents).toBeGreaterThan(1_800_000);
  });

  it("labels the transcript with our caller and the business", () => {
    expect(auditTranscript([{ role: "agent", message: "[happy] Hi there!" }, { role: "user", message: "Smith Auto" }, { role: "user", message: null }])).toBe("Caller: Hi there!\nBusiness: Smith Auto");
  });
});

describe("cost", () => {
  it("estimates a typical 3-bay shop audit at a few dollars", () => {
    const c = estimateAuditCost(18);
    expect(c.total).toBeGreaterThan(400);
    expect(c.total).toBeLessThan(1000);
    expect(c.elevenLabs).toBeGreaterThan(c.twilio);
  });
  it("bills unanswered calls one Twilio minute", () => {
    const c = auditCostCents({ answered: 0, answeredMinutes: 0, unanswered: 10 });
    expect(c.elevenLabs).toBe(0);
    expect(c.twilio).toBe(Math.round((10 * 0.014 + 10 * 0.0075) * 1.38 * 100));
  });
});
