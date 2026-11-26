// Special offers for one account: a discount (% off, $ off, or a set monthly price) for some
// months or for good, and/or free months, until a deadline. Applied on the account's Stripe
// checkout link. Pure; unit tested.

import type { BillingInterval } from "./billing-rules";

export type OfferKind = "percent" | "amount" | "price" | "none";
export type Offer = {
  kind: OfferKind;
  percentOff: number | null;
  /** For "amount" and "price": the discount per month, in the account's currency (cents). */
  amountOffCents: number | null;
  currency: "CAD" | "USD";
  /** Months the discount lasts; null = for as long as they stay subscribed. */
  durationMonths: number | null;
  trialMonths: number;
  expiresAt: Date;
  usedAt?: Date | null;
};

export const DEFAULT_REP_CAP_PERCENT = 20;
export const REP_MAX_TRIAL_MONTHS = 1;
export const MAX_TRIAL_MONTHS = 3;
export const DEFAULT_OFFER_DAYS = 14;
export const REP_CAP_KEY = "billing.repDiscountCapPercent";

const money = (cents: number, currency: "CAD" | "USD") => `${currency === "USD" ? "US$" : "CA$"}${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export type OfferInput = { kind: string; value: string; duration: string; trialMonths: string; validDays: string };

/** Check what was typed into the offer form. `monthlyCents` is the plan's monthly price in the account's currency. */
export function parseOffer(input: OfferInput, monthlyCents: number, currency: "CAD" | "USD", now = new Date()): Offer | { error: string } {
  const kind = (["percent", "amount", "price", "none"].includes(input.kind) ? input.kind : "") as OfferKind;
  if (!kind) return { error: "Choose the kind of offer." };
  const trialMonths = Math.round(Number(input.trialMonths || 0));
  if (!Number.isFinite(trialMonths) || trialMonths < 0 || trialMonths > MAX_TRIAL_MONTHS) return { error: `Free months must be 0 to ${MAX_TRIAL_MONTHS}.` };
  const days = Math.round(Number(input.validDays || DEFAULT_OFFER_DAYS));
  if (!Number.isFinite(days) || days < 1 || days > 90) return { error: "The offer must be good for 1 to 90 days." };
  const expiresAt = new Date(now.getTime() + days * 86_400_000);

  let percentOff: number | null = null;
  let amountOffCents: number | null = null;
  if (kind !== "none") {
    const v = Number(String(input.value).replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(v) || v <= 0) return { error: kind === "price" ? "Enter their monthly price." : "Enter the discount." };
    if (kind === "percent") {
      if (v >= 100) return { error: "Use free months for 100% off; a discount must be under 100%." };
      percentOff = Math.round(v);
    } else if (kind === "amount") {
      amountOffCents = Math.round(v * 100);
      if (amountOffCents >= monthlyCents) return { error: `The discount must be less than the ${money(monthlyCents, currency)} monthly price.` };
    } else {
      const price = Math.round(v * 100);
      if (price >= monthlyCents) return { error: `Their price must be below the normal ${money(monthlyCents, currency)}.` };
      if (price < 100) return { error: "Their price must be at least $1 a month (use free months for free)." };
      amountOffCents = monthlyCents - price;
    }
  } else if (!trialMonths) {
    return { error: "Add a discount or at least one free month." };
  }

  let durationMonths: number | null = null;
  if (kind !== "none" && input.duration !== "forever") {
    durationMonths = Math.round(Number(input.duration));
    if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 36) return { error: "The discount lasts 1 to 36 months, or for good." };
  }
  return { kind, percentOff, amountOffCents, currency, durationMonths: kind === "none" ? null : durationMonths, trialMonths, expiresAt };
}

/** The discount as a % of the monthly price (for the reps' limit). */
export function discountPercent(o: Pick<Offer, "kind" | "percentOff" | "amountOffCents">, monthlyCents: number): number {
  if (o.kind === "percent") return o.percentOff ?? 0;
  if (o.kind === "amount" || o.kind === "price") return monthlyCents ? Math.round(((o.amountOffCents ?? 0) / monthlyCents) * 1000) / 10 : 0;
  return 0;
}

/** Null when a sales rep may give this offer; otherwise why an admin has to. */
export function repLimitProblem(o: Offer, monthlyCents: number, capPercent: number): string | null {
  const pct = discountPercent(o, monthlyCents);
  if (pct > capPercent) return `Sales reps can give up to ${capPercent}% off (this is ${pct}%). Ask an admin to set it.`;
  if (o.trialMonths > REP_MAX_TRIAL_MONTHS) return `Sales reps can give up to ${REP_MAX_TRIAL_MONTHS} free month. Ask an admin for more.`;
  return null;
}

export function offerActive(o: Pick<Offer, "expiresAt" | "usedAt">, now = new Date()): boolean {
  return !o.usedAt && o.expiresAt.getTime() > now.getTime();
}

/** e.g. "1 free month, then 50% off for the next 3 months". */
export function describeOffer(o: Offer, monthlyCents: number): string {
  const first = o.trialMonths ? "the next" : "the first";
  const how = o.durationMonths == null ? "for as long as they stay" : o.durationMonths === 1 ? `for ${first} month` : `for ${first} ${o.durationMonths} months`;
  let discount = "";
  if (o.kind === "percent") discount = `${o.percentOff}% off ${how}`;
  if (o.kind === "amount") discount = `${money(o.amountOffCents ?? 0, o.currency)} off a month ${how}`;
  if (o.kind === "price") discount = `${money(monthlyCents - (o.amountOffCents ?? 0), o.currency)}/month instead of ${money(monthlyCents, o.currency)} ${how}`;
  const free = o.trialMonths ? `${o.trialMonths} free month${o.trialMonths === 1 ? "" : "s"}` : "";
  return free && discount ? `${free}, then ${discount}` : free || discount;
}

/** What they save in the first year on monthly billing (the free months count in full). */
export function firstYearSavingsCents(o: Offer, monthlyCents: number): number {
  const paidMonths = Math.max(0, 12 - o.trialMonths);
  const discounted = Math.min(paidMonths, o.durationMonths ?? 12);
  const perMonth = o.kind === "percent" ? Math.round((monthlyCents * (o.percentOff ?? 0)) / 100) : o.amountOffCents ?? 0;
  return o.trialMonths * monthlyCents + discounted * perMonth;
}

export type CouponSpec = {
  percent_off?: number;
  amount_off?: number;
  currency?: string;
  duration: "once" | "repeating" | "forever";
  duration_in_months?: number;
};

/**
 * The Stripe coupon for this offer on a monthly or yearly subscription. Stripe counts a coupon's
 * months from sign-up, free months included, so those are added on; and it applies a coupon to
 * whole invoices, so on yearly billing (one invoice a year, already 20% off) the same share is
 * taken off: "for good" becomes that % off every year, and "N months" becomes N twelfths of that
 * % off the first paid year (a coupon that lasts until just before the first renewal, so the $0
 * invoice for free months can't use it up). Null when there's no discount (free months only).
 */
export function couponFor(o: Offer, monthlyCents: number, interval: BillingInterval, annualCents: number): CouponSpec | null {
  if (o.kind === "none") return null;
  const currency = o.currency.toLowerCase();
  if (interval === "month") {
    const base: Pick<CouponSpec, "duration" | "duration_in_months"> = o.durationMonths == null ? { duration: "forever" } : { duration: "repeating", duration_in_months: o.durationMonths + o.trialMonths };
    return o.kind === "percent" ? { percent_off: o.percentOff!, ...base } : { amount_off: o.amountOffCents!, currency, ...base };
  }
  const share = o.kind === "percent" ? o.percentOff! / 100 : o.amountOffCents! / monthlyCents;
  if (o.durationMonths == null) return { percent_off: Math.round(share * 10000) / 100, duration: "forever" };
  const months = Math.min(12, o.durationMonths);
  return { amount_off: Math.min(annualCents - 100, Math.round((annualCents * share * months) / 12)), currency, duration: "repeating", duration_in_months: o.trialMonths + 11 };
}

/** The end of the free months (Stripe's trial_end), a calendar month at a time. */
export function trialEnd(o: Pick<Offer, "trialMonths">, now = new Date()): Date | null {
  if (!o.trialMonths) return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() + o.trialMonths);
  return d;
}
