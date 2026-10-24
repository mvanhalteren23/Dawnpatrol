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
