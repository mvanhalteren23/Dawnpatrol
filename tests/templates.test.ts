import { describe, expect, it } from "vitest";
import { AGENT_TEMPLATES, isCanadian, missingStarters, TEMPLATE_KEYS, templateFor, templateGaps, templateSettings } from "@/lib/agent-templates";

describe("agent templates", () => {
  it("every template has the recording notice and the platform-wide policies", () => {
    for (const k of TEMPLATE_KEYS) {
      const t = AGENT_TEMPLATES[k];
      expect(t.settings.greeting({ businessName: "Acme", name: "Ava" })).toContain("calls are recorded");
      const titles = t.knowledge.map((x) => x.title);
      for (const must of ["Payment details over the phone", "Call recording", "Emergencies"]) expect(titles).toContain(must);
      // Fill-in entries never go live with placeholder text.
      expect(t.knowledge.filter((x) => x.content.startsWith("TO FILL IN")).every((x) => !x.active)).toBe(true);
      expect(t.settings.checkinThreshold).toBeGreaterThanOrEqual(3);
    }
  });

  it("picks the template from the business's industry", () => {
    expect(templateFor("Auto Repair").key).toBe("auto_repair");
    expect(templateFor("Plumbing").key).toBe("contractor");
    expect(templateFor("Hair salon").key).toBe("retail");
    expect(templateFor("Accounting").key).toBe("general");
    expect(templateFor("Auto Repair", "followup").key).toBe("followup");
  });

  it("switches on BC holidays for Canadian businesses", () => {
    const t = AGENT_TEMPLATES.auto_repair;
    expect(templateSettings(t, { businessName: "A", name: "B", canadian: true }).bookingHolidays).toBe("CA-BC");
    expect(templateSettings(t, { businessName: "A", name: "B", canadian: false }).bookingHolidays).toBe("");
    expect(isCanadian({ state: "BC" })).toBe(true);
    expect(isCanadian({ state: "WA", timezone: "America/Los_Angeles" })).toBe(false);
    expect(isCanadian({ timezone: "America/Vancouver" })).toBe(true);
  });

  it("applying to an existing agent only fills blanks and factory defaults", () => {
    const t = AGENT_TEMPLATES.contractor;
    const gaps = templateGaps({ persona: "Warm, concise, professional.", greeting: "Hi, it's Bob's Plumbing!", escalationRules: "", bookingTitle: "Site visit" }, t, { businessName: "Bob's", name: "Ava" });
    expect(gaps.persona).toBe(t.settings.persona);
    expect(gaps.escalationRules).toBe(t.settings.escalationRules);
    expect(gaps).not.toHaveProperty("greeting"); // set by the team
    expect(gaps).not.toHaveProperty("bookingTitle");
    expect(missingStarters(t, ["Call recording", "emergencies"]).map((k) => k.title)).not.toContain("Call recording");
  });
});
