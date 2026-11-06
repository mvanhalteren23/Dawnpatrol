import { describe, expect, it } from "vitest";
import { callableLineType, callerKey, callerOverLimit, clampGuard, conversationLimits, demoLineLimits, isAnonymous, isCanadaOrUs, lineTripReason, type RecentCall } from "@/lib/call-guard-rules";
import { dialableNumber } from "@/lib/twilio";

const now = new Date("2026-11-06T18:00:00Z");
const call = (sid: string, minsAgo: number, sec: number): RecentCall => ({ sid, startTime: new Date(now.getTime() - minsAgo * 60_000), durationSec: sec });
const limits = { maxConcurrentCalls: 3, callerDailyCalls: 5, callerDailyMinutes: 20 };

describe("call protections", () => {
  it("caps calls and minutes per caller over the last 24 hours, not counting this call", () => {
    const four = [1, 2, 3, 4].map((i) => call(`CA${i}`, i * 10, 60));
    expect(callerOverLimit(four, { thisSid: "CAnow", limits, anonymous: false, now })).toBeNull();
    expect(callerOverLimit([...four, call("CA5", 50, 60)], { thisSid: "CAnow", limits, anonymous: false, now })).toBe("calls");
    expect(callerOverLimit([...four, call("CAnow", 0, 0)], { thisSid: "CAnow", limits, anonymous: false, now })).toBeNull();
    expect(callerOverLimit([call("CA1", 30, 21 * 60)], { thisSid: "CAnow", limits, anonymous: false, now })).toBe("minutes");
    expect(callerOverLimit([call("CA1", 25 * 60, 60 * 60)], { thisSid: "CAnow", limits, anonymous: false, now })).toBeNull();
  });

  it("gives withheld numbers a smaller shared allowance", () => {
    expect(isAnonymous("anonymous")).toBe(true);
    expect(isAnonymous("+266696687")).toBe(true);
    expect(isAnonymous("")).toBe(true);
    expect(isAnonymous("+16045550100")).toBe(false);
    expect(callerKey("Restricted")).toBe("anonymous");
    const three = [1, 2, 3].map((i) => call(`CA${i}`, i, 30));
    expect(callerOverLimit(three, { thisSid: "x", limits, anonymous: true, now })).toBe("calls");
    expect(callerOverLimit(three, { thisSid: "x", limits, anonymous: false, now })).toBeNull();
  });

  it("uses the stricter limits on the demo line", () => {
    expect(demoLineLimits({ maxConcurrentCalls: 3, callerDailyCalls: 5, callerDailyMinutes: 20 })).toEqual({ maxConcurrentCalls: 2, callerDailyCalls: 3, callerDailyMinutes: 20 });
    expect(demoLineLimits({ maxConcurrentCalls: 1, callerDailyCalls: 2, callerDailyMinutes: 10 })).toEqual({ maxConcurrentCalls: 1, callerDailyCalls: 2, callerDailyMinutes: 10 });
    expect(demoLineLimits(null).callerDailyCalls).toBe(3);
  });

  it("trips the daily cutoff past the limit or 3x a usual day", () => {
    expect(lineTripReason({ last24hMinutes: 151, usualDailyMinutes: 0, limit: 150 })).toContain("over the line's limit of 150");
    expect(lineTripReason({ last24hMinutes: 100, usualDailyMinutes: 20, limit: 150 })).toContain("3x its usual 20");
    expect(lineTripReason({ last24hMinutes: 50, usualDailyMinutes: 20, limit: 150 })).toBeNull();
    expect(lineTripReason({ last24hMinutes: 25, usualDailyMinutes: 5, limit: 150 })).toBeNull(); // too little history to compare
  });

  it("only dials real Canadian and US numbers", () => {
    expect(isCanadaOrUs("+16045550100")).toBe(true);
    expect(isCanadaOrUs("+12125550100")).toBe(true);
    expect(isCanadaOrUs("+18765550100")).toBe(false); // Jamaica
    expect(isCanadaOrUs("+18095550100")).toBe(false); // Dominican Republic
    expect(isCanadaOrUs("+447700900123")).toBe(false);
    expect(dialableNumber("876-555-0100")).toBeNull();
    expect(dialableNumber("604-555-0100")).toBe("+16045550100");
    expect(callableLineType("mobile")).toBe(true);
    expect(callableLineType("premium")).toBe(false);
    expect(callableLineType(null)).toBe(true);
  });

  it("sets call length and silence on the agent, within bounds", () => {
    expect(conversationLimits({ maxCallMinutes: 10, silenceHangupSeconds: 30 })).toEqual({ conversation: { max_duration_seconds: 600 }, turn: { silence_end_call_timeout: 30 } });
    expect(conversationLimits({ maxCallMinutes: 500, silenceHangupSeconds: 1 })).toEqual({ conversation: { max_duration_seconds: 3600 }, turn: { silence_end_call_timeout: 10 } });
    expect(clampGuard("lineDailyMinutes", Number("abc"), 150)).toBe(150);
  });
});
