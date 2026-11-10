// Billing rules (pure; unit tested): currency, Canadian sales tax, the minimum-term cancel lock,
// and extra-minute blocks.

import { FOLLOWUP_ADDON_PRICE, PRICES, PRICING, type Currency } from "./site-content";

const CA_PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export function isUsState(state: string | null | undefined): boolean {
  return US_STATES.includes((state ?? "").trim().toUpperCase()) && !CA_PROVINCES.includes((state ?? "").trim().toUpperCase());
}

/** US clients are billed in USD; everyone else in CAD. */
export function currencyForAccount(state: string | null | undefined): Currency {
  return isUsState(state) ? "USD" : "CAD";
}

export type SalesTax = { name: "GST" | "HST"; percent: number; jurisdiction: string } | null;

/**
 * GST/HST on our services by the client's province (place of supply). HST provinces: Ontario 13%,
 * Nova Scotia 14% (from April 2025), New Brunswick, Newfoundland and Labrador, PEI 15%; elsewhere in
 * Canada GST 5% (also when the province isn't known). US clients: none (zero-rated export).
 * Provincial sales tax (BC PST, QST) isn't included: check with your accountant.
 */
export function salesTaxFor(state: string | null | undefined): SalesTax {
  const s = (state ?? "").trim().toUpperCase();
  if (isUsState(s)) return null;
  if (s === "ON") return { name: "HST", percent: 13, jurisdiction: "ON" };
  if (s === "NS") return { name: "HST", percent: 14, jurisdiction: "NS" };
  if (s === "NB" || s === "NL" || s === "PE") return { name: "HST", percent: 15, jurisdiction: s };
  return { name: "GST", percent: 5, jurisdiction: CA_PROVINCES.includes(s) ? s : "CA" };
}

/** The cancel option stays hidden until the minimum term is up. */
export function cancelLockedUntil(startedAt: Date | null, minimumMonths: number): Date | null {
  if (!startedAt || minimumMonths <= 0) return null;
  const d = new Date(startedAt);
  d.setUTCMonth(d.getUTCMonth() + minimumMonths);
  return d;
}

export function cancelLocked(startedAt: Date | null, minimumMonths: number, now = new Date()): boolean {
  const until = cancelLockedUntil(startedAt, minimumMonths);
  return Boolean(until && now.getTime() < until.getTime());
}

/** Extra minutes are billed in whole blocks: 201-300 minutes is one block, 301-400 two, and so on. */
export function overageBlocks(minutes: number, included: number = PRICING.includedMinutes, blockMinutes: number = PRICING.blockMinutes): number {
  return minutes > included ? Math.ceil((minutes - included) / blockMinutes) : 0;
}

export function blockPriceCents(currency: Currency): number {
  return PRICES[currency].blockPrice * 100;
}

/** The 75% heads-up (and its key, so it's sent once per billing period). */
export const USAGE_NOTICE_SHARE = 0.75;

/**
 * What a plan costs per month in a currency, in cents, when Stripe has no price for it yet.
 * CAD is the plan's own price. USD is only known for the published prices (the Voice Agent and
 * the Follow-Up add-on); any other plan needs its USD price set by hand. Null = not known.
 */
export function planPriceCents(plan: { priceCents: number; kind: string }, currency: Currency): number | null {
  if (currency === "CAD") return plan.priceCents > 0 ? plan.priceCents : null;
  if (plan.kind === "addon") return FOLLOWUP_ADDON_PRICE && plan.priceCents === FOLLOWUP_ADDON_PRICE.CAD * 100 ? FOLLOWUP_ADDON_PRICE.USD * 100 : null;
  return plan.priceCents === PRICES.CAD.monthly * 100 ? PRICES.USD.monthly * 100 : null;
}

/** Stripe lookup key for a plan's price: the same plan, currency and amount always finds the same price. */
export function planPriceKey(planId: string, currency: Currency, cents: number): string {
  return `plan_${planId}_${currency.toLowerCase()}_${cents}`;
}
