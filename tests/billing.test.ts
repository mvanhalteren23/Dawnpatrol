import { describe, expect, it } from "vitest";
import { blockPriceCents, cancelLocked, cancelLockedUntil, currencyForAccount, overageBlocks, salesTaxFor } from "@/lib/billing-rules";

describe("billing rules", () => {
  it("bills US clients in USD and everyone else in CAD", () => {
    expect(currencyForAccount("WA")).toBe("USD");
    expect(currencyForAccount("BC")).toBe("CAD");
    expect(currencyForAccount(null)).toBe("CAD");
  });

  it("adds GST or HST by province, and none for US clients", () => {
    expect(salesTaxFor("BC")).toEqual({ name: "GST", percent: 5, jurisdiction: "BC" });
    expect(salesTaxFor("AB")?.percent).toBe(5);
    expect(salesTaxFor("ON")).toEqual({ name: "HST", percent: 13, jurisdiction: "ON" });
    expect(salesTaxFor("NS")?.percent).toBe(14);
    expect(salesTaxFor("PE")?.percent).toBe(15);
    expect(salesTaxFor(null)).toEqual({ name: "GST", percent: 5, jurisdiction: "CA" });
    expect(salesTaxFor("TX")).toBeNull();
  });

  it("hides cancelling for the first three months", () => {
    const start = new Date("2026-11-05T12:00:00Z");
    expect(cancelLockedUntil(start, 3)?.toISOString()).toBe("2027-02-05T12:00:00.000Z");
    expect(cancelLocked(start, 3, new Date("2027-01-20T00:00:00Z"))).toBe(true);
    expect(cancelLocked(start, 3, new Date("2027-02-06T00:00:00Z"))).toBe(false);
    expect(cancelLocked(null, 3)).toBe(false);
    expect(cancelLocked(start, 0)).toBe(false);
  });

  it("bills extra minutes in whole 100-minute blocks", () => {
    expect(overageBlocks(200)).toBe(0);
    expect(overageBlocks(201)).toBe(1);
    expect(overageBlocks(300)).toBe(1);
    expect(overageBlocks(301)).toBe(2);
    expect(overageBlocks(450, 300)).toBe(2);
    expect(blockPriceCents("CAD")).toBe(2500);
    expect(blockPriceCents("USD")).toBe(1900);
  });
});
