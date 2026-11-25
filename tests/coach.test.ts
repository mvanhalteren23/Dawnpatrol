import { describe, expect, it } from "vitest";
import { bestScript, callText, coachMaterial, scriptReviewReady, scriptStats, statsTable, type CoachCall } from "@/lib/coach-rules";

const call = (o: Partial<CoachCall>): CoachCall => ({ id: Math.random().toString(36), accountId: "a", accountName: "Elm Plumbing", industry: "Plumbing", scriptId: "s1", outcome: "connected", durationSec: 120, occurredAt: new Date("2026-11-20T18:00:00Z"), body: null, rep: "Matt", ...o });

describe("sales coach", () => {
  it("counts calls, conversations, meetings and closed deals per script", () => {
    const calls = [
      call({ scriptId: "s1", outcome: "booked", accountId: "a1", occurredAt: new Date("2026-11-10") }),
      call({ scriptId: "s1", outcome: "no_answer" }),
      call({ scriptId: "s1", outcome: "not_interested" }),
      call({ scriptId: "s2", outcome: "interested", accountId: "a2", occurredAt: new Date("2026-11-11") }),
      call({ scriptId: "s1", outcome: "connected", accountId: "a2", occurredAt: new Date("2026-11-12") }),
      call({ scriptId: null, outcome: "voicemail" }),
    ];
    const stats = scriptStats(calls, new Map([["a1", new Date("2026-11-15")], ["a2", new Date("2026-11-11T12:00:00Z")]]));
    const s1 = stats.find((s) => s.scriptId === "s1")!;
    const s2 = stats.find((s) => s.scriptId === "s2")!;
    expect(s1).toMatchObject({ calls: 4, connected: 3, meetings: 1, deals: 1 });
    expect(s1.meetingRate).toBeCloseTo(1 / 3);
    // a2 signed after the s2 call and before the later s1 call: the deal goes to s2.
    expect(s2.deals).toBe(1);
    expect(stats.find((s) => s.scriptId === null)).toMatchObject({ calls: 1, connected: 0 });
  });

  it("only calls a script best once it has enough conversations", () => {
    const few = scriptStats([call({ outcome: "booked" })], new Map());
    expect(bestScript(few)).toBeNull();
    const many = scriptStats(Array.from({ length: 6 }, () => call({ outcome: "connected" })), new Map());
    expect(bestScript(many)?.scriptId).toBe("s1");
    expect(scriptReviewReady(7)).toEqual({ ready: false, remaining: 3 });
    expect(scriptReviewReady(10).ready).toBe(true);
  });

  it("gives the coach the summary and a trimmed transcript, labelled with the script and outcome", () => {
    const body = `Asked about pricing\n\nSummary: Owner was busy but interested.\n\nSuggested next step: Call Tuesday\n\nTranscript:\nRep: Hi\nProspect: ${"x".repeat(3000)}`;
    const t = callText(body);
    expect(t).toContain("Summary: Owner was busy but interested.");
    expect(t).toContain("Transcript: Rep: Hi");
    expect(t.length).toBeLessThan(2700);
    const m = coachMaterial([call({ body }), call({ body: null })], new Map([["s1", "Missed-call cost"]]));
    expect(m).toContain("script: Missed-call cost · outcome: connected · 2 min · rep: Matt");
    expect(m.match(/### Call/g)?.length).toBe(1); // calls without notes are skipped
    expect(statsTable(scriptStats([call({ outcome: "booked" })], new Map()), new Map([["s1", "A"]]))).toContain("A: 1 calls, 1 conversations (100%), 1 meetings");
  });
});
