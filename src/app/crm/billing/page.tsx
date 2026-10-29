import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { db } from "@/lib/db";
import { stripeConfigured } from "@/lib/billing";
import { computeMrr, payingSubscriptions } from "@/lib/metrics";
import { formatDate, formatMoney } from "@/lib/utils";
import { Field, Notice, PageHeader, Stat, StatusBadge, Empty } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { savePlan } from "../actions";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const [plans, subs, openInvoices, paidThisMonth] = await Promise.all([
    db.plan.findMany({ orderBy: { priceCents: "asc" }, include: { _count: { select: { subscriptions: true } } } }),
    db.subscription.findMany({ include: { account: true, plan: true }, orderBy: { mrrCents: "desc" } }),
    db.invoice.findMany({ where: { status: { in: ["OPEN", "UNCOLLECTIBLE"] } }, include: { account: true }, orderBy: { dueDate: "asc" } }),
    db.invoice.aggregate({ where: { status: "PAID", paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }, _sum: { amountCents: true } }),
  ]);
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
            {!plans.length ? <Empty>Create your first plan (e.g. Starter $297, Growth $497, Pro $997).</Empty> : null}
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

function PlanForm({ plan }: { plan?: { id: string; name: string; priceCents: number; setupFeeCents: number; includedMinutes: number; minimumMonths: number; features: string; stripePriceId: string | null } }) {
  return (
    <form action={savePlan} className="mt-3 grid grid-cols-2 gap-2">
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <Field label="Name"><input name="name" defaultValue={plan?.name} className="input" required /></Field>
      <Field label="Monthly price ($)"><input name="price" defaultValue={plan ? plan.priceCents / 100 : ""} className="input" required /></Field>
      <Field label="Setup fee ($)"><input name="setupFee" defaultValue={plan ? plan.setupFeeCents / 100 : ""} className="input" /></Field>
      <Field label="Included minutes"><input name="includedMinutes" type="number" defaultValue={plan?.includedMinutes} className="input" /></Field>
      <Field label="Minimum term (months)"><input name="minimumMonths" type="number" min={0} defaultValue={plan?.minimumMonths ?? 0} className="input" /></Field>
      <Field label="Stripe price id" className="col-span-2"><input name="stripePriceId" defaultValue={plan?.stripePriceId ?? ""} placeholder="price_…" className="input" /></Field>
      <Field label="Features (one per line)" className="col-span-2"><textarea name="features" rows={3} defaultValue={plan?.features} className="input" /></Field>
      <div className="col-span-2"><button className="btn-secondary">{plan ? "Save plan" : "Create plan"}</button></div>
    </form>
  );
}
