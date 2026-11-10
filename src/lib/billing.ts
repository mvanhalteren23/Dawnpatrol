import { TERMS_VERSION, SITE_TERMS_URL, SITE_PRIVACY_URL } from "./terms";
import "server-only";
import { appUrl } from "./app-url";
import Stripe from "stripe";
import { db } from "./db";
import { changeStage, recordActivity } from "./outreach";
import { getSetting, setSetting } from "./settings";
import { blockPriceCents, cancelLocked, cancelLockedUntil, currencyForAccount, overageBlocks, planPriceCents, planPriceKey, salesTaxFor, type SalesTax } from "./billing-rules";

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

type PricedPlan = { id: string; name: string; priceCents: number; kind: string; stripePriceId: string | null; stripePriceIdUsd: string | null };

/**
 * The plan's Stripe price in this currency. If none is saved (or the saved one belongs to
 * another Stripe mode, e.g. test vs live), the product and monthly price are created in Stripe
 * and saved on the plan, so nothing has to be set up in Stripe by hand.
 */
async function ensurePrice(plan: PricedPlan, currency: "CAD" | "USD"): Promise<string> {
  const saved = currency === "USD" ? plan.stripePriceIdUsd : plan.stripePriceId;
  if (saved) {
    const ok = await stripe().prices.retrieve(saved).then((p) => p.active, () => false);
    if (ok) return saved;
  }
  const cents = planPriceCents(plan, currency);
  if (!cents) throw new Error(`"${plan.name}" has no ${currency} price: set one in CRM → Billing (Stripe price id${currency === "USD" ? ", USD" : ""})`);
  const key = planPriceKey(plan.id, currency, cents);
  const found = await stripe().prices.list({ lookup_keys: [key], active: true, limit: 1 });
  let id = found.data[0]?.id;
  if (!id) {
    const price = await stripe().prices.create({
      currency: currency.toLowerCase(),
      unit_amount: cents,
      recurring: { interval: "month" },
      lookup_key: key,
      product_data: { name: `Head Above Digital: ${plan.name}`, metadata: { planId: plan.id } },
      metadata: { planId: plan.id },
    });
    id = price.id;
  }
  await db.plan.update({ where: { id: plan.id }, data: currency === "USD" ? { stripePriceIdUsd: id } : { stripePriceId: id } });
  return id;
}

/** Hosted Stripe Checkout for a plan — send the link to the client or open it from the portal. */
export async function createCheckout(accountId: string, planId: string, returnPath: string, addOnIds: string[] = []): Promise<string> {
  const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { state: true } });
  // US clients pay in USD; everyone else in CAD.
  const currency = currencyForAccount(account.state);
  const priceId = await ensurePrice(plan, currency);
  const taxRate = await taxRateId(salesTaxFor(account.state));
  // Add-ons (e.g. the Follow-Up Agent) ride on the same subscription, in the same currency.
  const addOns = addOnIds.length ? await db.plan.findMany({ where: { id: { in: addOnIds }, kind: "addon", isActive: true } }) : [];
  const addOnPrices: string[] = [];
  for (const a of addOns) addOnPrices.push(await ensurePrice(a, currency));
  const customer = await ensureCustomer(accountId);
  await db.subscription.update({ where: { accountId }, data: { planId } });
  const app = appUrl();
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    line_items: [{ price: priceId, quantity: 1 }, ...addOnPrices.map((price) => ({ price, quantity: 1 }))],
    client_reference_id: accountId,
    subscription_data: { metadata: { accountId, planId, termsVersion: TERMS_VERSION }, ...(taxRate ? { default_tax_rates: [taxRate] } : {}) },
    success_url: `${app}${returnPath}?billing=success`,
    cancel_url: `${app}${returnPath}?billing=cancelled`,
    // Signing up = ticking "I agree to the Terms of Service" on the checkout page.
    consent_collection: { terms_of_service: "required" },
    custom_text: { terms_of_service_acceptance: { message: `I agree to Head Above Digital's [Terms of Service](${SITE_TERMS_URL}) and [Privacy Policy](${SITE_PRIVACY_URL}). Billed monthly from today; cancel any time, effective at the end of the paid month.` } },
  };
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create(params);
  } catch (err) {
    // Stripe needs a Terms of Service URL in its settings (Settings → Public details) for the tick box.
    if (!/terms of service/i.test(String((err as Error).message))) throw err;
    console.warn("Stripe checkout: no Terms of Service URL set in Stripe; checkout created without the terms tick box");
    const { consent_collection: _c, custom_text: _t, ...rest } = params;
    session = await stripe().checkout.sessions.create(rest);
  }
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(accountId: string, returnPath: string): Promise<string> {
  const customer = await ensureCustomer(accountId);
  const sub = await db.subscription.findUnique({ where: { accountId }, include: { plan: { select: { minimumMonths: true } } } });
  const locked = cancelLocked(sub?.startedAt ?? null, sub?.plan?.minimumMonths ?? 0);
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
  const until = cancelLockedUntil(sub?.startedAt ?? null, sub?.plan?.minimumMonths ?? 0);
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
  // Blocks are normally charged the moment they're used (billExtraMinutesNow); this only catches any missed.
  const subId = typeof inv.parent?.subscription_details?.subscription === "string" ? inv.parent.subscription_details.subscription : null;
  const already = subId ? Number((await getSetting(overageKey(subId, inv.period_start))) ?? 0) : 0;
  const blocks = overageBlocks(minutes, included) - already;
  if (blocks <= 0) return;
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

const overageKey = (subscriptionId: string, periodStart: number) => `overage.billed.${subscriptionId}.${periodStart}`;

/**
 * Extra minutes are charged as soon as each 100-minute block is used: after every call on a paying
 * client's line, count this billing period's minutes and charge any new blocks right away (its own
 * invoice, paid with the card on file, with GST/HST). The renewal invoice catches anything missed.
 */
export async function billExtraMinutesNow(accountId: string): Promise<void> {
  if (!stripeConfigured()) return;
  const account = await db.account.findUnique({ where: { id: accountId }, include: { subscription: { include: { plan: true } } } });
  const sub = account?.subscription;
  if (!account || !sub?.stripeSubscriptionId || !sub.stripeCustomerId || !["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status)) return;
  const live = await stripe().subscriptions.retrieve(sub.stripeSubscriptionId);
  const item = live.items.data[0];
  if (!item?.current_period_start || !item.current_period_end) return;
  const start = new Date(item.current_period_start * 1000);
  const end = new Date(item.current_period_end * 1000);
  const used = await db.callLog.aggregate({
    where: { receptionist: { accountId, lifecycle: "production" }, startedAt: { gte: start, lt: end }, outcome: { not: "SPAM" } },
    _sum: { durationSec: true },
  });
  const minutes = Math.ceil((used._sum.durationSec ?? 0) / 60);
  const included = sub.plan?.includedMinutes || 200;
  const due = overageBlocks(minutes, included);
  const key = overageKey(live.id, item.current_period_start);
  const billed = Number((await getSetting(key)) ?? 0);
  if (due <= billed) return;
  const blocks = due - billed;
  const currency = live.currency?.toUpperCase() === "USD" ? "USD" : "CAD";
  const taxRate = await taxRateId(salesTaxFor(account.state));
  const tag = `${live.id}-${item.current_period_start}-${due}`;
  await setSetting(key, String(due)); // claim first, so two calls ending together can't both charge
  try {
    await stripe().invoiceItems.create(
      {
        customer: sub.stripeCustomerId,
        currency: currency.toLowerCase(),
        amount: blocks * blockPriceCents(currency),
        description: `Extra call minutes: ${minutes} used of ${included} included this month (${blocks} × 100-minute block)`,
        metadata: { accountId, kind: "extra_minutes", minutes: String(minutes) },
        ...(taxRate ? { tax_rates: [taxRate] } : {}),
      },
      { idempotencyKey: `extra-item-${tag}` },
    );
    const invoice = await stripe().invoices.create(
      { customer: sub.stripeCustomerId, collection_method: "charge_automatically", auto_advance: true, pending_invoice_items_behavior: "include", description: "Extra call minutes", metadata: { accountId, kind: "extra_minutes" } },
      { idempotencyKey: `extra-inv-${tag}` },
    );
    if (invoice.id) {
      const final = await stripe().invoices.finalizeInvoice(invoice.id);
      if (final.status === "open" && final.id) await stripe().invoices.pay(final.id).catch((e) => console.warn("extra minutes payment", (e as Error).message));
    }
  } catch (err) {
    await setSetting(key, String(billed)); // not charged: try again after the next call
    throw err;
  }
  const amount = (blocks * blockPriceCents(currency)) / 100;
  const note = `${account.name} has used ${minutes} of ${included} minutes this billing period (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}): ${blocks} extra 100-minute block${blocks === 1 ? "" : "s"} charged now, ${currency} $${amount.toFixed(2)} plus tax.`;
  await recordActivity({ accountId, type: "BILLING", source: "system", subject: `Extra minutes charged: ${blocks} block${blocks === 1 ? "" : "s"}`, body: note });
  await db.account.update({ where: { id: accountId }, data: { needsReview: true, reviewReason: `Extra minutes charged. ${note} Worth a call about their plan.` } });
  const { supportAddress } = await import("./google");
  const to = await supportAddress();
  if (to) {
    const { sendPlainEmail } = await import("./outreach");
    await sendPlainEmail({ to, subject: `Extra minutes charged: ${account.name}`, body: `${note}\n\n${appUrl()}/crm/accounts/${accountId}` }).catch((e) => console.warn("overage email", e));
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
  // Monthly revenue counts every item (the plan and any add-ons).
  const monthlyOf = (it: Stripe.SubscriptionItem) => {
    const unit = it.price?.unit_amount ?? 0;
    const interval = it.price?.recurring?.interval;
    const count = it.price?.recurring?.interval_count ?? 1;
    const monthly = interval === "year" ? unit / (12 * count) : interval === "week" ? (unit * 52) / (12 * count) : unit / count;
    return monthly * (it.quantity ?? 1);
  };
  const mrrCents = Math.round(sub.items.data.reduce((sum, it) => sum + monthlyOf(it), 0));
  const status = STATUS_MAP[sub.status] ?? "INCOMPLETE";
  // The plan is the item whose price belongs to a plan (not an add-on), in either currency.
  const priceIds = sub.items.data.map((it) => it.price?.id).filter(Boolean) as string[];
  const plan = priceIds.length ? await db.plan.findFirst({ where: { kind: "plan", OR: [{ stripePriceId: { in: priceIds } }, { stripePriceIdUsd: { in: priceIds } }] } }) : null;
  const item = sub.items.data.find((it) => it.price?.id && (it.price.id === plan?.stripePriceId || it.price.id === plan?.stripePriceIdUsd)) ?? sub.items.data[0];

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
      if (s.client_reference_id && s.consent?.terms_of_service === "accepted") {
        await recordActivity({ accountId: s.client_reference_id, type: "BILLING", source: "system", subject: "Terms of Service accepted", body: `Accepted the Terms of Service (version ${TERMS_VERSION}, ${SITE_TERMS_URL}) and Privacy Policy at checkout${s.customer_details?.email ? ` by ${s.customer_details.email}` : ""}, ${new Date().toISOString().slice(0, 10)}.` }).catch((e) => console.warn("terms acceptance note", e));
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
