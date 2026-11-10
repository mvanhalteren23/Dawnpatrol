import { describe, expect, it } from "vitest";
import { creditState, moneyState, sortChecks } from "@/lib/launch-check-rules";
import { planPriceCents, planPriceKey } from "@/lib/billing-rules";

describe("launch check", () => {
  it("flags credits before calls start dropping", () => {
    expect(creditState(1000, 10000)).toBe("ok");
    expect(creditState(8600, 10000)).toBe("warn");
    expect(creditState(9900, 10000)).toBe("todo");
    expect(creditState(0, 0)).toBe("unknown");
  });
  it("flags a low or empty prepaid balance", () => {
    expect(moneyState(42, 10)).toBe("ok");
    expect(moneyState(6, 10)).toBe("warn");
    expect(moneyState(0, 10)).toBe("todo");
    expect(moneyState(NaN, 10)).toBe("unknown");
  });
  it("lists blockers first", () => {
    expect(sortChecks([{ state: "ok" as const }, { state: "todo" as const }, { state: "warn" as const }]).map((c) => c.state)).toEqual(["todo", "warn", "ok"]);
  });
});

describe("plan prices created in Stripe", () => {
  it("uses the plan's own CAD price, and the published USD prices only", () => {
    expect(planPriceCents({ priceCents: 13900, kind: "plan" }, "CAD")).toBe(13900);
    expect(planPriceCents({ priceCents: 13900, kind: "plan" }, "USD")).toBe(10900);
    expect(planPriceCents({ priceCents: 5900, kind: "addon" }, "USD")).toBe(4500);
    expect(planPriceCents({ priceCents: 29700, kind: "plan" }, "USD")).toBeNull();
    expect(planPriceCents({ priceCents: 0, kind: "plan" }, "CAD")).toBeNull();
  });
  it("finds the same Stripe price again for the same plan, currency and amount", () => {
    expect(planPriceKey("abc", "CAD", 13900)).toBe("plan_abc_cad_13900");
    expect(planPriceKey("abc", "CAD", 14900)).not.toBe(planPriceKey("abc", "CAD", 13900));
  });
});
