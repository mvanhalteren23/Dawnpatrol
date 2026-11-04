import { describe, expect, it } from "vitest";
import { BUILDER_ESSENTIALS, buildBuilderPrompt, builderOpening, builderQuestions, conferenceName, demoState, isBuilderCode, joinConferenceTwiml, newBuilderCode, silentGatherTwiml } from "@/lib/builder-rules";

describe("live demo builder", () => {
  it("tells session codes apart from demo extensions", () => {
    expect(isBuilderCode("482913")).toBe(true);
    expect(isBuilderCode("101")).toBe(false);
    expect(isBuilderCode("48291a")).toBe(false);
    expect(newBuilderCode(() => 0)).toBe("100000");
    expect(newBuilderCode(() => 0.999999)).toMatch(/^\d{6}$/);
  });

  it("only the prospect's leg ends the conference", () => {
    expect(joinConferenceTwiml("123456", "prospect")).toContain('endConferenceOnExit="true"');
    expect(joinConferenceTwiml("123456", "rep")).toContain('endConferenceOnExit="false"');
    expect(joinConferenceTwiml("123456", "agent")).toContain(`>${conferenceName("123456")}</Conference>`);
    expect(silentGatherTwiml("https://x.test/a?b=1&c=2")).toContain('action="https://x.test/a?b=1&amp;c=2"');
    expect(silentGatherTwiml("https://x.test")).not.toContain("<Say");
  });

  it("is ready only once synced after the latest answers", () => {
    const at = new Date("2026-11-04T18:00:00Z");
    const synced = (when: string) => ({ syncStatus: "SYNCED", lastSyncedAt: new Date(when), elevenLabsAgentId: "agent_1" });
    expect(demoState(null, null)).toBe("none");
    expect(demoState({ syncStatus: "FAILED", lastSyncedAt: null, elevenLabsAgentId: null }, null)).toBe("failed");
    expect(demoState({ syncStatus: "NEVER", lastSyncedAt: null, elevenLabsAgentId: null }, null)).toBe("building");
    expect(demoState(synced("2026-11-04T17:59:00Z"), at)).toBe("building");
    expect(demoState(synced("2026-11-04T18:00:30Z"), at)).toBe("ready");
    expect(demoState(synced("2026-11-04T17:00:00Z"), null)).toBe("ready");
  });

  it("adds the basics after the business's own questions", () => {
    expect(builderQuestions(["Do you service Subarus?"])).toEqual(["Do you service Subarus?", ...BUILDER_ESSENTIALS]);
    expect(builderQuestions(Array.from({ length: 6 }, (_, i) => `Q${i}?`))).toHaveLength(7);
  });

  it("walks through questions, the live demo and a follow-up with the rep", () => {
    const p = buildBuilderPrompt({ name: "Sam", companyName: "Head Above Digital", persona: "Friendly", bookingEnabled: true, extraInstructions: "" });
    for (const tool of ["get_build_questions", "save_build_answers", "demo_status", "connect_live_demo", "leave_call", "book_appointment"]) expect(p).toContain(tool);
    expect(p).toContain("Never connect before demo_status says ready");
    expect(p).toContain("payment, banking, SIN or health");
    expect(buildBuilderPrompt({ name: "Sam", companyName: "Head Above Digital", persona: "Friendly", bookingEnabled: false, extraInstructions: "" })).not.toContain("book_appointment");
    expect(builderOpening({ name: "Sam", companyName: "Head Above Digital" })).toContain("{{prospect_business}}");
  });
});
