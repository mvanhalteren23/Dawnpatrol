import { describe, expect, it } from "vitest";
import { estimateCost, TASK_KEYS, TASKS } from "@/lib/ai/types";

describe("AI router types", () => {
  it("estimates Claude cost at list prices and leaves Gemini to Google", () => {
    expect(estimateCost("anthropic", "claude-sonnet-5-5", 1_000_000, 100_000)).toBeCloseTo(3);
    expect(estimateCost("anthropic", "unknown-model", 1000, 1000)).toBeNull();
    expect(estimateCost("gemini", "gemini-flash-latest", 1000, 1000)).toBeNull();
  });

  it("marks the web research jobs", () => {
    expect(TASK_KEYS.filter((t) => TASKS[t].web)).toEqual(["research", "prospecting", "kb_draft"]);
  });
});

describe("research guard", () => {
  it("drops contact details the report doesn't contain", async () => {
    const { verifySummary } = await import("@/lib/research-guard");
    const report = "Match: confirmed. Acme Plumbing (acmeplumbing.ca) — call 604-555-0101. Owner: Jane Smith (jane@acmeplumbing.ca).";
    const s = verifySummary(
      {
        match: "confirmed", fitScore: 70, estMissedCallsPerWeek: null, avgJobValueUsd: null, industry: "Plumbing",
        website: "https://acmeplumbing.ca", city: null, state: null, phone: "(604) 555-0101", employees: null,
        keyFacts: [], painSignals: [], suggestedOpener: "",
        decisionMakers: [
          { name: "Jane Smith", title: "Owner", email: "jane@acmeplumbing.ca", phone: "604-555-9999", linkedin: null },
          { name: "Bob Jones", title: "GM", email: "bob@acmeplumbing.ca", phone: null, linkedin: null },
        ],
      },
      report,
    );
    expect(s.website).toBe("https://acmeplumbing.ca");
    expect(s.phone).toBe("(604) 555-0101");
    expect(s.decisionMakers).toHaveLength(1);
    expect(s.decisionMakers[0]!.email).toBe("jane@acmeplumbing.ca");
    expect(s.decisionMakers[0]!.phone).toBeNull();
    const wrong = verifySummary({ ...s, website: "https://acme-plumbing.com", phone: "250-555-1212" }, report);
    expect(wrong.website).toBeNull();
    expect(wrong.phone).toBeNull();
  });
});

describe("email writer", () => {
  it("detects real edits but ignores whitespace", async () => {
    const { wasEdited } = await import("@/lib/utils");
    expect(wasEdited("Hi Jane,\n\nQuick question", "Hi Jane, Quick question")).toBe(false);
    expect(wasEdited("Hi Jane, quick question", "Jane, one question")).toBe(true);
  });
});
