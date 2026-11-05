import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { formatDate, formatMoney } from "@/lib/utils";
import { Empty, Notice, StatusBadge } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { companyName } from "@/lib/brand";
import { cancelAvailableFrom } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function PortalBilling({ searchParams }: { searchParams: Promise<{ account?: string; billing?: string }> }) {
  const sp = await searchParams;
  const { session, account, adminAccountId } = await loadPortal(Promise.resolve(sp));
  const [sub, invoices, cancelFrom] = await Promise.all([
    db.subscription.findUnique({ where: { accountId: account.id }, include: { plan: true } }),
    db.invoice.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 24 }),
    cancelAvailableFrom(account.id),
  ]);
  return (
    <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-6">Billing</h1>
      {sp.billing === "success" ? <Notice kind="success">Thanks! Your subscription is set up.</Notice> : null}
      <div className="card mb-6">
        {sub ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{sub.plan?.name ?? "Custom plan"} — {formatMoney(sub.mrrCents)}/month</div>
              <div className="flex items-center gap-2 text-sm text-slate-500"><StatusBadge status={sub.status} />{sub.currentPeriodEnd ? `Renews ${formatDate(sub.currentPeriodEnd)}` : null}</div>
              <p className="mt-1 text-xs text-slate-500">Prices are plus GST/HST for Canadian businesses. Minutes over your plan are billed in 100-minute blocks on your next invoice; we&apos;ll let you know before you get close.{cancelFrom ? ` Your plan has a minimum term, so cancelling is available from ${formatDate(cancelFrom)}.` : sub.stripeCustomerId ? " You can cancel any time under Manage subscription; it ends at the end of your billing month." : ""}</p>
              {sub.plan?.features ? <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">{sub.plan.features.split("\n").filter(Boolean).map((f, i) => <li key={i}>{f}</li>)}</ul> : null}
            </div>
            {sub.stripeCustomerId ? <form action="/api/billing/portal" method="post"><input type="hidden" name="accountId" value={account.id} /><button className="btn">{cancelFrom ? "Manage payment method" : "Manage subscription"}</button></form> : null}
          </div>
        ) : <Empty>No active subscription. Your {await companyName()} contact will send you a checkout link.</Empty>}
      </div>
      <div className="card">
        <h2 className="mb-3">Invoices</h2>
        {invoices.length ? (
          <table className="table"><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>{invoices.map((i) => <tr key={i.id}><td>{i.number ?? "—"}</td><td>{formatDate(i.createdAt)}</td><td>{formatMoney(i.amountCents)}</td><td><StatusBadge status={i.status} /></td><td>{i.hostedUrl ? <a href={i.hostedUrl} target="_blank" rel="noreferrer">{i.status === "OPEN" ? "Pay" : "View"}</a> : null}</td></tr>)}</tbody>
          </table>
        ) : <Empty>No invoices yet.</Empty>}
      </div>
    </PortalShell>
  );
}
