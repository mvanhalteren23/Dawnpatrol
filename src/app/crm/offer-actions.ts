"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { currencyForAccount, planPriceCents } from "@/lib/billing-rules";
import { REP_CAP_KEY, describeOffer, parseOffer, repLimitProblem } from "@/lib/offer-rules";
import { recordActivity } from "@/lib/outreach";
import { setSetting } from "@/lib/settings";
import { repDiscountCap } from "@/lib/offers";
import { canTouch } from "@/lib/team-rules";
import { str } from "@/lib/utils";

function back(path: string, params: Record<string, string>): never {
  revalidatePath(path);
  redirect(`${path}?${new URLSearchParams(params).toString()}#billing`);
}

/** Set (or replace) the account's special offer. Reps: up to the discount limit and 1 free month. */
export async function saveOffer(accountId: string, form: FormData) {
  const session = await requireStaff();
  const path = `/crm/accounts/${accountId}`;
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { ownerId: true, state: true, offer: { select: { usedAt: true } } } });
  if (!canTouch(session, account.ownerId)) back(path, { error: "Only the account's owner or an admin can give it an offer." });
  const plan = await db.plan.findFirst({ where: { id: str(form, "planId") || undefined, kind: "plan", isActive: true }, orderBy: { priceCents: "asc" } });
  if (!plan) back(path, { error: "Create a plan in Billing first." });
  const currency = currencyForAccount(account.state);
  const monthly = planPriceCents(plan, currency) ?? plan.priceCents;
  const parsed = parseOffer({ kind: str(form, "kind"), value: str(form, "value"), duration: str(form, "duration"), trialMonths: str(form, "trialMonths"), validDays: str(form, "validDays") }, monthly, currency);
  if ("error" in parsed) back(path, { error: parsed.error });
  if (session.role !== "ADMIN") {
    const problem = repLimitProblem(parsed, monthly, await repDiscountCap());
    if (problem) back(path, { error: problem });
  }
  const note = str(form, "note").slice(0, 300);
  const data = { kind: parsed.kind, percentOff: parsed.percentOff, amountOffCents: parsed.amountOffCents, currency, durationMonths: parsed.durationMonths, trialMonths: parsed.trialMonths, expiresAt: parsed.expiresAt, note, createdById: session.sub, usedAt: null };
  await db.accountOffer.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
  const text = describeOffer(parsed, monthly);
  await recordActivity({ accountId, type: "BILLING", source: "system", createdById: session.sub, subject: `Special offer: ${text}`, body: `On ${plan.name}. Good until ${parsed.expiresAt.toISOString().slice(0, 10)}; applies to the next Stripe checkout link.${note ? `\nNote: ${note}` : ""}` }).catch(() => null);
  back(path, { notice: `Offer saved: ${text}. Create the Stripe checkout link to send it.` });
}

export async function removeOffer(accountId: string) {
  const session = await requireStaff();
  const path = `/crm/accounts/${accountId}`;
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { ownerId: true } });
  if (!canTouch(session, account.ownerId)) back(path, { error: "Only the account's owner or an admin can change its offer." });
  await db.accountOffer.deleteMany({ where: { accountId } });
  await recordActivity({ accountId, type: "BILLING", source: "system", createdById: session.sub, subject: "Special offer removed" }).catch(() => null);
  back(path, { notice: "Offer removed. New checkout links use the normal price." });
}

/** Billing → the most a sales rep can discount on their own. */
export async function saveRepCap(form: FormData) {
  await requireAdmin();
  const n = Math.round(Number(str(form, "cap")));
  if (!Number.isFinite(n) || n < 0 || n > 99) redirect(`/crm/billing?error=${encodeURIComponent("Enter a limit from 0 to 99%.")}`);
  await setSetting(REP_CAP_KEY, String(n));
  revalidatePath("/crm/billing");
  redirect(`/crm/billing?notice=${encodeURIComponent(`Sales reps can now give up to ${n}% off`)}`);
}
