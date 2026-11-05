import { describe, expect, it } from "vitest";
import { callerTypeFor, keypadResult, matchDemoByName } from "@/lib/house-line-rules";
import { isClientStage } from "@/lib/constants";
import { buildReceptionistPrompt } from "@/lib/rag";

describe("company line", () => {
  it("tells Grace only the kind of caller", () => {
    expect(callerTypeFor(null, isClientStage)).toBe("new");
    expect(callerTypeFor({ stage: "CONTACTED" }, isClientStage)).toBe("prospect");
    expect(callerTypeFor({ stage: "ACTIVE" }, isClientStage)).toBe("client");
  });

  it("opens the menu on the code, keyed all at once or one digit at a time", () => {
    const base = { code: "1098", extensions: ["101", "102"] };
    expect(keypadResult({ ...base, previous: "", entered: "1098" }).action).toBe("menu");
    let prev = "";
    for (const d of "1098") {
      const r = keypadResult({ ...base, previous: prev, entered: d });
      prev = r.digits;
      if (d === "8") expect(r.action).toBe("menu");
    }
    expect(keypadResult({ ...base, previous: "", entered: "102" })).toMatchObject({ action: "extension", extension: "102" });
    expect(keypadResult({ ...base, previous: "", entered: "1099" }).action).toBe("none");
    expect(keypadResult({ ...base, previous: "", entered: "" }).action).toBe("none");
  });

  it("finds a demo by the company name said", () => {
    const demos = [{ businessName: "Shine 99 Property Services" }, { businessName: "Langley Auto Care Ltd." }];
    expect(matchDemoByName("shine ninety nine property services", demos)?.businessName).toBe("Shine 99 Property Services");
    expect(matchDemoByName("Langley Auto Care", demos)?.businessName).toBe("Langley Auto Care Ltd.");
    expect(matchDemoByName("pizza", demos)).toBeNull();
  });

  it("Grace's prompt uses the caller type without recapping, and never contains the code", () => {
    const p = buildReceptionistPrompt({ name: "Grace", businessName: "Head Above Digital", greeting: "", persona: "Warm", timezone: "America/Vancouver", businessHours: "", escalationRules: "", extraInstructions: "", bookingAddsToCrm: true, bookingEnabled: true });
    expect(p).toContain("{{caller_type}}");
    expect(p).toContain("don't bring up previous conversations");
    expect(p).toContain("keypad_entry");
    expect(p).not.toContain("1098");
  });
});
