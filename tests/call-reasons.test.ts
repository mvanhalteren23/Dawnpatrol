import { describe, expect, it } from "vitest";
import { callReasons, type ReasonInput } from "@/lib/call-reasons";

const now = new Date("2026-10-27T18:00:00Z");
const base: ReasonInput = { fitScore: null, lastContactedAt: null, nextFollowUpAt: null, openTasks: [], recent: [] };
const act = (o: Partial<ReasonInput["recent"][number]>) => ({ type: "EMAIL", direction: "OUTBOUND", source: "gmail", occurredAt: new Date("2026-10-25T18:00:00Z"), subject: null, openCount: 0, clickCount: 0, repliedAt: null, outcome: null, ...o });

describe("callReasons", () => {
  it("puts overdue tasks and replies first", () => {
    const r = callReasons({
      ...base,
      fitScore: 80,
      lastContactedAt: new Date("2026-10-25T18:00:00Z"),
      openTasks: [{ subject: "Call again", dueAt: new Date("2026-10-25T18:00:00Z") }],
      recent: [act({ direction: "INBOUND", occurredAt: new Date("2026-10-26T18:00:00Z") })],
    }, now);
    expect(r.reasons[0]).toBe("Task overdue 2d: Call again");
    expect(r.reasons[1]).toBe("Replied by email 1d ago");
    expect(r.reasons).toContain("High fit score (80)");
  });

  it("flags engaged opens, past call outcomes and cold accounts", () => {
    const r = callReasons({ ...base, lastContactedAt: new Date("2026-10-01T18:00:00Z"), recent: [act({ openCount: 3, subject: "Missed calls" }), act({ type: "CALL", outcome: "voicemail", occurredAt: new Date("2026-10-20T18:00:00Z") })] }, now);
    expect(r.reasons).toContain("Opened 3× your email “Missed calls”");
    expect(r.reasons).toContain("No touch in 26 days");
    expect(r.reasons.some((x) => x.includes("left voicemail"))).toBe(true);
    expect(callReasons(base, now).reasons).toEqual(["Never contacted"]);
  });

  it("ranks a hot account above a cold one", () => {
    const hot = callReasons({ ...base, recent: [act({ direction: "INBOUND", occurredAt: new Date("2026-10-27T10:00:00Z") })], lastContactedAt: now }, now);
    const cold = callReasons({ ...base, fitScore: 90 }, now);
    expect(hot.priority).toBeGreaterThan(cold.priority);
  });
});
