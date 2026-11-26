import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { db } from "@/lib/db";
import { stripeConfigured } from "@/lib/billing";
import { computeMrr, payingSubscriptions } from "@/lib/metrics";
import { formatDate, formatMoney } from "@/lib/utils";
import { Field, Notice, PageHeader, Stat, StatusBadge, Empty } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { savePlan } from "../actions";
import { saveRepCap } from "../offer-actions";
import { repDiscountCap } from "@/lib/offers";
import { describeOffer, offerActive, REP_MAX_TRIAL_MONTHS, type Offer } from "@/lib/offer-rules";
import { currencyForAccount, planPriceCents } from "@/lib/billing-rules";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const [plans, subs, openInvoices, paidThisMonth] = await Promise.all([
    db.plan.findMany({ orderBy: { priceCents: "asc" }, include: { _count: { select: { subscriptions: true } } } }),
    db.subscription.findMany({ include: { account: true, plan: true }, orderBy: { mrrCents: "desc" } }),
    db.invoice.findMany({ where: { status: { in: ["OPEN", "UNCOLLECTIBLE"] } }, include: { account: true }, orderBy: { dueDate: "asc" } }),
    db.invoice.aggregate({ where: { status: "PAID", paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }, _sum: { amountCents: true } }),
  ]);
  const [repCap, offers] = await Promise.all([
    repDiscountCap(),
    db.accountOffer.findMany({ where: { usedAt: null, expiresAt: { gt: new Date() } }, include: { account: { select: { id: true, name: true, state: true } } }, orderBy: { expiresAt: "asc" } }),
  ]);
  const basePlan = plans.find((p) => p.kind !== "addon" && p.isActive);
  const paying = payingSubscriptions(subs);
  const mrr = computeMrr(subs);
  return (
    <div>
      <PageHeader title="Billing" subtitle="Plans, subscriptions and invoices. Stripe keeps this in sync via webhook; manual clients count toward MRR too." />
      <Flash params={await searchParams} />
      {!stripeConfigured() ? <Notice>Stripe isn&apos;t configured — you can still track manual billing. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable checkout links and automatic sync.</Notice> : null}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="MRR" value={formatMoney(mrr)} />
        <Stat label="Paying clients" value={paying.length} sub={`ARPA ${formatMoney(paying.length ? mrr / paying.length : 0)}`} />
        <Stat label="Collected this month" value={formatMoney(paidThisMonth._sum.amountCents ?? 0)} />
        <Stat label="Open / overdue invoices" value={openInvoices.length} sub={formatMoney(openInvoices.reduce((s, i) => s + i.amountCents, 0))} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3">Plans</h2>
          <div className="space-y-3">
            {plans.map((p) => (
              <details key={p.id} className="rounded-lg border border-slate-200 p-3">
                <summary className="flex cursor-pointer justify-between text-sm"><span className="font-medium">{p.name} — {formatMoney(p.priceCents)}/mo</span><span className="text-xs text-slate-500">{p._count.subscriptions} clients</span></summary>
                <PlanForm plan={p} />
              </details>
            ))}
            {!plans.length ? <Empty>Create your first plan (e.g. Voice Agent $139/mo).</Empty> : null}
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold">New plan</h3>
          <PlanForm />
        </div>

        <div className="card">
          <h2 className="mb-3">Subscriptions</h2>
          {subs.length ? (
            <table className="table"><thead><tr><th>Client</th><th>Plan</th><th>MRR</th><th>Status</th><th>Renews</th></tr></thead>
              <tbody>{subs.map((s) => (
                <tr key={s.id}><td><Link href={`/crm/accounts/${s.accountId}`}>{s.account.name}</Link><div className="text-xs text-slate-400">{s.billingMethod}</div></td><td>{s.plan?.name ?? "—"}</td><td>{formatMoney(s.mrrCents)}</td><td><StatusBadge status={s.status} /></td><td className="text-xs">{formatDate(s.currentPeriodEnd)}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>No subscriptions yet.</Empty>}
        </div>

        <div className="card lg:col-span-2">
          <h2 className="mb-1">Special offers</h2>
          <p className="mb-3 text-sm text-slate-600">Set an offer from an account&apos;s page (Billing → Special offer); it&apos;s applied on that account&apos;s next Stripe checkout link until its deadline.</p>
          {offers.length ? (
            <ul className="mb-4 divide-y divide-slate-100 text-sm">
              {offers.filter((o) => offerActive(o)).map((o) => {
                const monthly = basePlan ? planPriceCents(basePlan, currencyForAccount(o.account.state)) ?? basePlan.priceCents : 0;
                return <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2"><span><Link href={`/crm/accounts/${o.account.id}#billing`}>{o.account.name}</Link>: {describeOffer(o as unknown as Offer, monthly)}</span><span className="text-xs text-slate-500">until {formatDate(o.expiresAt)}</span></li>;
              })}
            </ul>
          ) : <p className="mb-4 text-sm text-slate-500">No open offers.</p>}
          <form action={saveRepCap} className="flex flex-wrap items-end gap-2 text-sm">
            <label className="block"><span className="label">Most a sales rep can give on their own</span><span className="flex items-center gap-1"><input name="cap" type="number" min={0} max={99} defaultValue={repCap} className="input w-24" />% off</span></label>
            <button className="btn-secondary">Save</button>
            <span className="text-xs text-slate-500">…and up to {REP_MAX_TRIAL_MONTHS} free month. Admins can give any offer.</span>
          </form>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="mb-3">Open & overdue invoices</h2>
          {openInvoices.length ? (
            <table className="table"><thead><tr><th>Client</th><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>{openInvoices.map((i) => (
                <tr key={i.id}><td><Link href={`/crm/accounts/${i.accountId}`}>{i.account.name}</Link></td><td>{i.number}</td><td>{formatMoney(i.amountCents)}</td><td className={i.dueDate && i.dueDate < new Date() ? "text-red-600" : ""}>{formatDate(i.dueDate)}</td><td><StatusBadge status={i.status} /></td><td>{i.hostedUrl ? <a href={i.hostedUrl} target="_blank" rel="noreferrer">open</a> : null}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>Nothing outstanding.</Empty>}
        </div>
      </div>
    </div>
  );
}

function PlanForm({ plan }: { plan?: { id: string; name: string; priceCents: number; setupFeeCents: number; includedMinutes: number; minimumMonths: number; features: string; stripePriceId: string | null; stripePriceIdUsd: string | null; kind: string } }) {
  return (
    <form action={savePlan} className="mt-3 grid grid-cols-2 gap-2">
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <Field label="Name"><input name="name" defaultValue={plan?.name} className="input" required /></Field>
      <Field label="Type"><select name="kind" defaultValue={plan?.kind ?? "plan"} className="input"><option value="plan">Plan</option><option value="addon">Add-on (ticked onto a plan at checkout)</option></select></Field>
      <Field label="Monthly price ($)"><input name="price" defaultValue={plan ? plan.priceCents / 100 : ""} className="input" required /></Field>
      <Field label="Setup fee ($)"><input name="setupFee" defaultValue={plan ? plan.setupFeeCents / 100 : ""} className="input" /></Field>
      <Field label="Included minutes"><input name="includedMinutes" type="number" defaultValue={plan?.includedMinutes} className="input" /></Field>
      <Field label="Minimum term (months)"><input name="minimumMonths" type="number" min={0} defaultValue={plan?.minimumMonths ?? 0} className="input" /></Field>
      <Field label="Stripe price id (CAD)"><input name="stripePriceId" defaultValue={plan?.stripePriceId ?? ""} placeholder="blank = created automatically" className="input" /></Field>
      <Field label="Stripe price id (USD, for US clients)"><input name="stripePriceIdUsd" defaultValue={plan?.stripePriceIdUsd ?? ""} placeholder="price_…" className="input" /></Field>
      <Field label="Features (one per line)" className="col-span-2"><textarea name="features" rows={3} defaultValue={plan?.features} className="input" /></Field>
      <div className="col-span-2"><button className="btn-secondary">{plan ? "Save plan" : "Create plan"}</button></div>
    </form>
  );
}
