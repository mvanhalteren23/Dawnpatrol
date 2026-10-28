import { describe, expect, it } from "vitest";
import { accountKeyName, canTouch, isStaff, phoneKey, weightedForecastCents } from "../src/lib/team-rules";

describe("canTouch", () => {
  const rep = { sub: "rep1", role: "REP" };
  it("lets reps work their own and unassigned accounts only", () => {
    expect(canTouch(rep, "rep1")).toBe(true);
    expect(canTouch(rep, null)).toBe(true);
    expect(canTouch(rep, "rep2")).toBe(false);
  });
  it("lets admins work any account and clients none", () => {
    expect(canTouch({ sub: "a", role: "ADMIN" }, "rep2")).toBe(true);
    expect(canTouch({ sub: "c", role: "CLIENT" }, null)).toBe(false);
  });
  it("treats admins and reps as staff", () => {
    expect(isStaff("ADMIN")).toBe(true);
    expect(isStaff("REP")).toBe(true);
    expect(isStaff("CLIENT")).toBe(false);
  });
});

describe("duplicate keys", () => {
  it("matches phone numbers on the last 10 digits", () => {
    expect(phoneKey("+1 (604) 966-8897")).toBe("6049668897");
    expect(phoneKey("604.966.8897")).toBe("6049668897");
    expect(phoneKey("966-8897")).toBeNull();
  });
  it("ignores case, punctuation and company suffixes in names", () => {
    expect(accountKeyName("The Shine 99 Co.")).toBe(accountKeyName("shine99"));
    expect(accountKeyName("DeRosa Automotive Ltd.")).toBe("derosaautomotive");
    expect(accountKeyName("Acme Plumbing, Inc")).toBe("acmeplumbing");
    expect(accountKeyName("Coastal Heating")).toBe("coastalheating"); // "co" only as a whole word
  });
});

describe("weightedForecastCents", () => {
  it("weights each open account by its stage", () => {
    expect(weightedForecastCents([{ stage: "PROPOSAL" }, { stage: "DEMO" }, { stage: "ACTIVE" }], 100_00)).toBe(95_00);
  });
});
