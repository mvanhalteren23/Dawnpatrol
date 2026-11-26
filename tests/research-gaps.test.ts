import { describe, expect, it } from "vitest";
import { carryForward, changedFields, gapsBudget, gapsPrompt, knownProfile, missingItems, updatePrompt, type KnownInput } from "@/lib/research-gaps";
import { leadFacts, withLeadFacts } from "@/lib/prospect-leads-rules";

const base: KnownInput = {
  account: { name: "Elm Plumbing", website: "https://elmplumbing.ca", phone: "604-555-0142", city: "Squamish", state: "BC", industry: "Plumbing", employees: null, notes: "" },
  contacts: [],
  reports: [],
  summaries: [],
};

describe("what's known and what's missing", () => {
  it("a fresh lead knows the basics only", () => {
    const k = knownProfile(base);
    expect(k.website).toBe("https://elmplumbing.ca");
    expect(k.address).toBe("Squamish, BC");
    expect(missingItems(k)).toEqual(["services", "hours", "team", "people", "rating", "social", "reach"]);
  });
  it("reads earlier research, notes and contacts, and ignores 'unknown' lines", () => {
    const k = knownProfile({
      ...base,
      account: { ...base.account, notes: "Researched lead.\nGoogle: 4.8★ from 63 reviews." },
      contacts: [{ firstName: "Dana", lastName: "Reyes", title: "Owner", email: null, phone: null }],
      reports: ["Match: confirmed\n- Services: drain cleaning, hot water tanks ([source](https://x))\n- Hours: Mon-Fri 8-5 ([source](https://x))\n- Team size: unknown\n- Social: facebook.com/elm ([source](https://x))\n- How customers reach them: phone; no online booking ([source](https://x))\n- Address: 38000 Cleveland Ave, Squamish ([source](https://x))"],
    });
    expect(k.people).toBe("Dana Reyes, Owner");
    expect(k.rating).toContain("4.8");
    expect(k.services).toContain("Plumbing. Services: drain cleaning");
    expect(k.hours).toContain("Mon-Fri 8-5");
    expect(k.address).toContain("38000 Cleveland Ave");
    expect(missingItems(k)).toEqual(["team"]);
  });
  it("narrows the profile prompt to the gaps, or skips it when complete", () => {
    const g = gapsPrompt("Build a fact-checked company profile of Elm Plumbing.", knownProfile(base))!;
    expect(g.missing).toHaveLength(7);
    expect(g.prompt).toContain("Don't search for these again");
    expect(g.prompt).toContain("- Main phone number: 604-555-0142");
    expect(g.prompt).toMatch(/Search ONLY for what's still missing:\n- What they do/);
    const full = Object.fromEntries(Object.keys(knownProfile(base)).map((k) => [k, "x"])) as ReturnType<typeof knownProfile>;
    expect(gapsPrompt("p", full)).toBeNull();
    expect(gapsBudget(1)).toEqual({ maxSearches: 2, maxFetches: 1 });
    expect(gapsBudget(7)).toEqual({ maxSearches: 5, maxFetches: 3 });
  });
  it("the update prompt lists what's on file to re-check", () => {
    const u = updatePrompt("Elm Plumbing", knownProfile(base), "2026-11-26");
    expect(u).toContain("today is 2026-11-26");
    expect(u).toContain("- Official website: https://elmplumbing.ca");
    expect(u).toContain('"changed: <the new value>"');
    expect(u).toContain("business hours");
  });
});

describe("carrying what's known forward", () => {
  const prior = { keyFacts: ["Pays for leads: Google Local Services Ads"], painSignals: ["Reviews mention no callback"], suggestedOpener: "I saw you're on LSA…", kbQuestions: ["Do you do drains?"] };
  const next = { keyFacts: ["Open Mon-Fri"], painSignals: [], suggestedOpener: "Hi there", kbQuestions: ["New q?"] };
  it("gaps keeps the earlier opener and questions and adds facts", () => {
    expect(carryForward(next, prior, "gaps")).toEqual({ keyFacts: ["Pays for leads: Google Local Services Ads", "Open Mon-Fri"], painSignals: ["Reviews mention no callback"], suggestedOpener: "I saw you're on LSA…", kbQuestions: ["Do you do drains?"] });
  });
  it("update prefers what it just found", () => {
    expect(carryForward(next, prior, "update")).toMatchObject({ keyFacts: ["Open Mon-Fri", "Pays for leads: Google Local Services Ads"], suggestedOpener: "Hi there", kbQuestions: ["New q?"] });
  });
  it("lists changed fields", () => {
    expect(changedFields({ phone: "604-555-0142", city: "Squamish" }, { phone: "778-555-0199", city: "Squamish" }, { phone: "Phone", city: "City" })).toEqual(["Phone: 604-555-0142 → 778-555-0199"]);
  });
});

describe("lead findings as research", () => {
  const lead = { channels: { lsa: true, googleVerified: true, homestarsVerified: true }, evidence: [{ channel: "lsa", url: "https://google.com/lsa", note: "Sponsored card" }], signals: ["Reviews mention calls going to voicemail"], googleRating: 4.8, reviewCount: 63, notes: "" };
  it("paid channels, rating and signals become facts, signals and an opener", () => {
    const f = leadFacts(lead, { industry: "Plumbing", region: "Squamish, BC" });
    expect(f.keyFacts).toEqual(["Pays for leads: Google Local Services Ads, HomeStars Verified (paid member)", "Google Verified (Local Services)", "Google: 4.8★ from 63 reviews"]);
    expect(f.painSignals[0]).toMatch(/^Pays per lead on Google Local Services Ads and 1 more/);
    expect(f.painSignals[1]).toBe("Reviews mention calls going to voicemail");
    expect(f.opener).toMatch(/^I saw you're on Google Local Services Ads/);
    expect(f.report).toContain("([source](https://google.com/lsa))");
    const merged = withLeadFacts({ keyFacts: ["Since 2011"], painSignals: [], suggestedOpener: "" }, f);
    expect(merged.keyFacts[0]).toMatch(/^Pays for leads/);
    expect(merged.keyFacts).toContain("Since 2011");
    expect(merged.suggestedOpener).toBe(f.opener);
  });
});
