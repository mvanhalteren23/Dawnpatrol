import { describe, expect, it } from "vitest";
import { couponFor, describeOffer, discountPercent, firstYearSavingsCents, offerActive, parseOffer, repLimitProblem, trialEnd, type Offer } from "@/lib/offer-rules";

const now = new Date("2026-11-26T12:00:00Z");
const P = 13900; // CA$139
const parse = (o: Partial<{ kind: string; value: string; duration: string; trialMonths: string; validDays: string }>) =>
  parseOffer({ kind: "percent", value: "", duration: "3", trialMonths: "0", validDays: "14", ...o }, P, "CAD", now);
const ok = (o: Parameters<typeof parse>[0]) => {
  const r = parse(o);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("parseOffer", () => {
  it("reads each kind of offer", () => {
    expect(ok({ kind: "percent", value: "25%" })).toMatchObject({ kind: "percent", percentOff: 25, durationMonths: 3, trialMonths: 0 });
    expect(ok({ kind: "amount", value: "$30", duration: "forever" })).toMatchObject({ amountOffCents: 3000, durationMonths: null });
    expect(ok({ kind: "price", value: "109", duration: "12" })).toMatchObject({ kind: "price", amountOffCents: 3000, durationMonths: 12 });
    expect(ok({ kind: "none", trialMonths: "2" })).toMatchObject({ kind: "none", percentOff: null, amountOffCents: null, durationMonths: null, trialMonths: 2 });
    expect(ok({ value: "10", validDays: "7" }).expiresAt.toISOString()).toBe("2026-12-03T12:00:00.000Z");
  });
  it("refuses what doesn't make sense", () => {
    expect(parse({ value: "100" })).toMatchObject({ error: expect.stringMatching(/free months/) });
    expect(parse({ kind: "amount", value: "139" })).toMatchObject({ error: expect.stringMatching(/less than the CA\$139/) });
    expect(parse({ kind: "price", value: "150" })).toMatchObject({ error: expect.stringMatching(/below the normal/) });
    expect(parse({ kind: "none" })).toMatchObject({ error: expect.stringMatching(/at least one free month/) });
    expect(parse({ value: "10", trialMonths: "4" })).toMatchObject({ error: expect.stringMatching(/0 to 3/) });
    expect(parse({ value: "10", validDays: "200" })).toMatchObject({ error: expect.stringMatching(/1 to 90 days/) });
    expect(parse({ value: "" })).toMatchObject({ error: expect.stringMatching(/Enter the discount/) });
  });
});

describe("limits, wording and savings", () => {
  it("caps sales reps by % and free months", () => {
    expect(discountPercent(ok({ kind: "price", value: "109" }), P)).toBe(21.6);
    expect(repLimitProblem(ok({ value: "20" }), P, 20)).toBeNull();
    expect(repLimitProblem(ok({ kind: "price", value: "109" }), P, 20)).toMatch(/up to 20% off \(this is 21.6%\)/);
    expect(repLimitProblem(ok({ kind: "none", trialMonths: "2" }), P, 20)).toMatch(/1 free month/);
  });
  it("describes the offer in plain words", () => {
    expect(describeOffer(ok({ value: "50", trialMonths: "1" }), P)).toBe("1 free month, then 50% off for the next 3 months");
    expect(describeOffer(ok({ kind: "none", trialMonths: "2" }), P)).toBe("2 free months");
    expect(describeOffer(ok({ value: "20" }), P)).toBe("20% off for the first 3 months");
    expect(describeOffer(ok({ kind: "price", value: "109", duration: "forever" }), P)).toBe("CA$109/month instead of CA$139 for as long as they stay");
    expect(describeOffer(ok({ kind: "amount", value: "30", duration: "1" }), P)).toBe("CA$30 off a month for the first month");
  });
  it("works out first-year savings", () => {
    expect(firstYearSavingsCents(ok({ value: "50", trialMonths: "1" }), P)).toBe(13900 + 3 * 6950);
    expect(firstYearSavingsCents(ok({ kind: "price", value: "109", duration: "forever", trialMonths: "2" }), P)).toBe(2 * 13900 + 10 * 3000);
  });
  it("is good until its deadline and only once", () => {
    const o = ok({ value: "10" });
    expect(offerActive(o, now)).toBe(true);
    expect(offerActive(o, new Date("2026-12-11T00:00:00Z"))).toBe(false);
    expect(offerActive({ ...o, usedAt: now }, now)).toBe(false);
    expect(trialEnd({ trialMonths: 2 }, now)?.toISOString().slice(0, 10)).toBe("2027-01-26");
    expect(trialEnd({ trialMonths: 0 }, now)).toBeNull();
  });
});

describe("Stripe coupon", () => {
  const annual = 133440; // 12 × 139 less 20%
  it("monthly: repeating or forever, % or amount", () => {
    expect(couponFor(ok({ value: "25" }), P, "month", annual)).toEqual({ percent_off: 25, duration: "repeating", duration_in_months: 3 });
    expect(couponFor(ok({ kind: "price", value: "109", duration: "forever" }), P, "month", annual)).toEqual({ amount_off: 3000, currency: "cad", duration: "forever" });
    expect(couponFor(ok({ kind: "none", trialMonths: "1" }), P, "month", annual)).toBeNull();
    // Stripe counts coupon months from sign-up, so free months are added on.
    expect(couponFor(ok({ value: "25", trialMonths: "2" }), P, "month", annual)).toEqual({ percent_off: 25, duration: "repeating", duration_in_months: 5 });
  });
  it("yearly: the same share off, once for N months or every year for good", () => {
    expect(couponFor(ok({ value: "25", duration: "forever" }), P, "year", annual)).toEqual({ percent_off: 25, duration: "forever" });
    expect(couponFor(ok({ kind: "price", value: "109", duration: "forever" }), P, "year", annual)).toEqual({ percent_off: 21.58, duration: "forever" });
    // 50% off 3 months = 3/12 of 50% of the yearly invoice.
    expect(couponFor(ok({ value: "50", duration: "3" }), P, "year", annual)).toEqual({ amount_off: 16680, currency: "cad", duration: "repeating", duration_in_months: 11 });
    // With free months, it still lasts past the first paid (yearly) invoice and ends before renewal.
    expect(couponFor(ok({ value: "50", duration: "3", trialMonths: "1" }), P, "year", annual)).toMatchObject({ duration: "repeating", duration_in_months: 12 });
    const o: Offer = { ...ok({ value: "90", duration: "12" }) };
    expect(couponFor(o, P, "year", annual)?.amount_off).toBe(120096);
  });
});
