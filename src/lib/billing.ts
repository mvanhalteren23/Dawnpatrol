import "server-only";
import Stripe from "stripe";
import { db } from "./db";
import { changeStage } from "./outreach";

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
  if (!plan.stripePriceId) throw new Error(`Plan "${plan.name}" has no Stripe price id`);
  const customer = await ensureCustomer(accountId);
  await db.subscription.update({ where: { accountId }, data: { planId } });
  const app = process.env.APP_URL?.replace(/\/$/, "");
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    client_reference_id: accountId,
    subscription_data: { metadata: { accountId, planId } },
    success_url: `${app}${returnPath}?billing=success`,
    cancel_url: `${app}${returnPath}?billing=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(accountId: string, returnPath: string): Promise<string> {
  const customer = await ensureCustomer(accountId);
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${process.env.APP_URL?.replace(/\/$/, "")}${returnPath}`,
  });
  return session.url;
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
