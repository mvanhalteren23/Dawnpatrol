import "server-only";
import { appUrl } from "./app-url";
import Stripe from "stripe";
import { db } from "./db";
import { changeStage, recordActivity } from "./outreach";
import { getSetting, setSetting } from "./settings";
import { blockPriceCents, cancelLocked, cancelLockedUntil, currencyForAccount, overageBlocks, salesTaxFor, type SalesTax } from "./billing-rules";

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

const STATUS_MAP: Record<string, string> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  unpaid: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELED",
  paused: "PAST_DUE",
};

async function ensureCustomer(accountId: string): Promise<string> {
  const account = await db.account.findUniqueOrThrow({
    where: { id: accountId },
    include: { subscription: true, contacts: { orderBy: { isPrimary: "desc" }, take: 1 } },
  });
  if (account.subscription?.stripeCustomerId) return account.subscription.stripeCustomerId;
  const customer = await stripe().customers.create({
    name: account.name,
    email: account.contacts[0]?.email ?? undefined,
    phone: account.phone ?? undefined,
    metadata: { accountId },
  });
  await db.subscription.upsert({
    where: { accountId },
    create: { accountId, stripeCustomerId: customer.id, billingMethod: "stripe" },
    update: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/** Hosted Stripe Checkout for a plan — send the link to the client or open it from the portal. */
export async function createCheckout(accountId: string, planId: string, returnPath: string): Promise<string> {
  const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { state: true } });
  // US clients pay in USD; everyone else in CAD.
  const currency = currencyForAccount(account.state);
  const priceId = currency === "USD" ? plan.stripePriceIdUsd : plan.stripePriceId;
  if (!priceId) throw new Error(`Plan "${plan.name}" has no Stripe ${currency} price id (CRM → Billing → the plan)`);
  const taxRate = await taxRateId(salesTaxFor(account.state));
  const customer = await ensureCustomer(accountId);
  await db.subscription.update({ where: { accountId }, data: { planId } });
  const app = appUrl();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: accountId,
    subscription_data: { metadata: { accountId, planId }, ...(taxRate ? { default_tax_rates: [taxRate] } : {}) },
    success_url: `${app}${returnPath}?billing=success`,
    cancel_url: `${app}${returnPath}?billing=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(accountId: string, returnPath: string): Promise<string> {
  const customer = await ensureCustomer(accountId);
  const sub = await db.subscription.findUnique({ where: { accountId }, include: { plan: { select: { minimumMonths: true } } } });
  const locked = cancelLocked(sub?.startedAt ?? null, sub?.plan?.minimumMonths ?? 3);
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${appUrl()}${returnPath}`,
    configuration: await portalConfiguration(locked),
  });
  return session.url;
}

/** When a client can cancel in the portal (end of their minimum term), for the billing page. */
export async function cancelAvailableFrom(accountId: string): Promise<Date | null> {
  const sub = await db.subscription.findUnique({ where: { accountId }, include: { plan: { select: { minimumMonths: true } } } });
  const until = cancelLockedUntil(sub?.startedAt ?? null, sub?.plan?.minimumMonths ?? 3);
  return until && until.getTime() > Date.now() ? until : null;
}

/**
 * Two Stripe customer-portal setups, created once and kept: during the minimum term (card,
 * invoices and details, no cancel option) and after it (cancel at the end of the billing period).
 */
async function portalConfiguration(locked: boolean): Promise<string> {
  const key = locked ? "stripe.portal.locked" : "stripe.portal.open";
  const existing = await getSetting(key);
  if (existing) return existing;
  const config = await stripe().billingPortal.configurations.create({
    business_profile: { headline: locked ? "Manage your payment details and invoices" : "Manage your subscription" },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "phone", "name"] },
      subscription_cancel: locked ? { enabled: false } : { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
    },
  });
  await setSetting(key, config.id);
  return config.id;
}

/** The Stripe tax rate for GST/HST (created once per rate and kept). */
async function taxRateId(tax: SalesTax): Promise<string | null> {
  if (!tax) return null;
  const key = `stripe.taxRate.${tax.name}.${tax.percent}`;
  const existing = await getSetting(key);
  if (existing) return existing;
  const rate = await stripe().taxRates.create({ display_name: tax.name, percentage: tax.percent, inclusive: false, country: "CA", ...(tax.jurisdiction !== "CA" ? { state: tax.jurisdiction } : {}), tax_type: tax.name === "HST" ? "hst" : "gst", description: `${tax.name} ${tax.percent}%` });
  await setSetting(key, rate.id);
  return rate.id;
}

/**
 * Extra minutes, billed automatically: when Stripe drafts a renewal invoice (it waits about an
 * hour before finalising), count the month's call minutes and add the 100-minute blocks over the
 * plan to it, with GST/HST. Flagged on the account and emailed to the team.
 */
async function addOverage(inv: Stripe.Invoice) {
  if (inv.status !== "draft" || inv.billing_reason !== "subscription_cycle" || !inv.id) return;
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  if (!customerId) return;
  const accountId = await accountIdForCustomer(customerId, inv.parent?.subscription_details?.metadata?.accountId);
  if (!accountId) return;
  const account = await db.account.findUnique({ where: { id: accountId }, include: { subscription: { include: { plan: true } } } });
  if (!account) return;
  const start = new Date(inv.period_start * 1000);
  const end = new Date(inv.period_end * 1000);
  const used = await db.callLog.aggregate({
    where: { receptionist: { accountId, lifecycle: "production" }, startedAt: { gte: start, lt: end }, outcome: { not: "SPAM" } },
    _sum: { durationSec: true },
  });
  const minutes = Math.ceil((used._sum.durationSec ?? 0) / 60);
  const included = account.subscription?.plan?.includedMinutes || 200;
  const blocks = overageBlocks(minutes, included);
  if (!blocks) return;
  const currency = inv.currency?.toUpperCase() === "USD" ? "USD" : "CAD";
  const taxRate = await taxRateId(salesTaxFor(account.state));
  await stripe().invoiceItems.create(
    {
      customer: customerId,
      invoice: inv.id,
      currency: currency.toLowerCase(),
      amount: blocks * blockPriceCents(currency),
      description: `Extra call minutes: ${minutes} used, ${included} included (${blocks} × 100-minute block)`,
      metadata: { accountId, kind: "extra_minutes", minutes: String(minutes) },
      ...(taxRate ? { tax_rates: [taxRate] } : {}),
    },
    { idempotencyKey: `extra-minutes-${inv.id}` },
  );
  const amount = (blocks * blockPriceCents(currency)) / 100;
  const note = `${account.name} used ${minutes} of ${included} minutes (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}): ${blocks} extra 100-minute block${blocks === 1 ? "" : "s"}, ${currency} $${amount.toFixed(2)} plus tax, added to their renewal invoice.`;
  await recordActivity({ accountId, type: "BILLING", source: "system", subject: `Extra minutes billed: ${blocks} block${blocks === 1 ? "" : "s"}`, body: note });
  await db.account.update({ where: { id: accountId }, data: { needsReview: true, reviewReason: `Extra minutes billed this month. ${note} Worth a call about their plan.` } });
  const { supportAddress } = await import("./google");
  const to = await supportAddress();
  if (to) {
    const { sendPlainEmail } = await import("./outreach");
    await sendPlainEmail({ to, subject: `Extra minutes billed: ${account.name}`, body: `${note}

${appUrl()}/crm/accounts/${accountId}` }).catch((e) => console.warn("overage email", e));
  }
}

async function accountIdForCustomer(customerId: string, metadataAccountId?: string | null): Promise<string | null> {
  if (metadataAccountId) return metadataAccountId;
  const sub = await db.subscription.findFirst({ where: { stripeCustomerId: customerId } });
  return sub?.accountId ?? null;
}

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const accountId = await accountIdForCustomer(customerId, sub.metadata?.accountId);
  if (!accountId) return;
  const item = sub.items.data[0];
  const unit = item?.price?.unit_amount ?? 0;
  const interval = item?.price?.recurring?.interval;
  const count = item?.price?.recurring?.interval_count ?? 1;
  const monthly = interval === "year" ? unit / (12 * count) : interval === "week" ? (unit * 52) / (12 * count) : unit / count;
  const mrrCents = Math.round(monthly * (item?.quantity ?? 1));
  const status = STATUS_MAP[sub.status] ?? "INCOMPLETE";
  const plan = item?.price?.id ? await db.plan.findFirst({ where: { stripePriceId: item.price.id } }) : null;

  await db.subscription.upsert({
    where: { accountId },
    create: {
      accountId,
      status,
      mrrCents,
      billingMethod: "stripe",
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      planId: plan?.id,
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      startedAt: new Date(sub.start_date * 1000),
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
    update: {
      status,
      mrrCents,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      ...(plan ? { planId: plan.id } : {}),
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });

  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return;
  if ((status === "ACTIVE" || status === "TRIALING") && !["ACTIVE", "ONBOARDING"].includes(account.stage)) {
    await changeStage(accountId, account.stage === "PAST_DUE" ? "ACTIVE" : "ONBOARDING");
  } else if (status === "PAST_DUE" && account.stage === "ACTIVE") {
    await changeStage(accountId, "PAST_DUE");
  } else if (status === "CANCELED" && account.stage !== "CHURNED") {
    await changeStage(accountId, "CHURNED");
  }
}

const INVOICE_STATUS: Record<string, string> = { draft: "DRAFT", open: "OPEN", paid: "PAID", void: "VOID", uncollectible: "UNCOLLECTIBLE" };

async function syncInvoice(inv: Stripe.Invoice) {
  if (!inv.id) return;
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  if (!customerId) return;
  const accountId = await accountIdForCustomer(customerId, inv.parent?.subscription_details?.metadata?.accountId);
  if (!accountId) return;
  const status = INVOICE_STATUS[inv.status ?? "open"] ?? "OPEN";
  const data = {
    accountId,
    number: inv.number,
    amountCents: inv.amount_due,
    status,
    dueDate: inv.due_date ? new Date(inv.due_date * 1000) : null,
    paidAt: status === "PAID" ? new Date((inv.status_transitions?.paid_at ?? Date.now() / 1000) * 1000) : null,
    hostedUrl: inv.hosted_invoice_url ?? null,
  };
  const existing = await db.invoice.findUnique({ where: { stripeInvoiceId: inv.id } });
  await db.invoice.upsert({ where: { stripeInvoiceId: inv.id }, create: { ...data, stripeInvoiceId: inv.id }, update: data });
  if (!existing || existing.status !== status) {
    await db.activity.create({
      data: { accountId, type: "BILLING", source: "system", subject: `Invoice ${inv.number ?? inv.id} ${status.toLowerCase()}`, body: `$${(inv.amount_due / 100).toFixed(2)}` },
    });
  }
}

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.subscription) {
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
        await syncSubscription(await stripe().subscriptions.retrieve(subId));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
    case "invoice.created":
      await addOverage(event.data.object).catch((e) => console.error("extra minutes", e));
      break;
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.voided":
    case "invoice.marked_uncollectible":
      await syncInvoice(event.data.object);
      break;
    default:
      break;
  }
}

/** Manual (non-Stripe) billing for clients who pay by ACH/cheque — still counts toward MRR. */
export async function setManualSubscription(accountId: string, planId: string | null, mrrCents: number, status: string) {
  await db.subscription.upsert({
    where: { accountId },
    create: { accountId, planId, mrrCents, status, billingMethod: "manual", startedAt: new Date() },
    update: { planId, mrrCents, status, billingMethod: "manual" },
  });
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  if (status === "ACTIVE" && !["ACTIVE", "ONBOARDING"].includes(account.stage)) await changeStage(accountId, "ONBOARDING");
  if (status === "CANCELED" && account.stage !== "CHURNED") await changeStage(accountId, "CHURNED");
}
