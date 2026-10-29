import Link from "next/link";
import type { ReactNode } from "react";
import { companyName } from "@/lib/brand";
import { db } from "@/lib/db";
import { supportAddress } from "@/lib/google";

export async function PortalShell({ accountId, accountName, adminAccountId, email, children }: { accountId: string; accountName: string; adminAccountId?: string; email: string; children: ReactNode }) {
  const q = adminAccountId ? `?account=${adminAccountId}` : "";
  const [company, followups, support] = await Promise.all([companyName(), db.receptionist.count({ where: { accountId, agentType: "followup" } }), supportAddress().catch(() => null)]);
  return (
    <div className="min-h-screen">
      {adminAccountId ? (
        <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900">Admin preview of {accountName}&apos;s portal · <Link href={`/crm/accounts/${adminAccountId}`}>back to CRM</Link></div>
      ) : null}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="font-semibold">🌅 {accountName}</div>
            <div className="text-xs text-slate-500">AI receptionist by {company}</div>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link href={`/portal${q}`}>Overview</Link>
            <Link href={`/portal/knowledge${q}`}>What it knows</Link>
            <Link href={`/portal/calls${q}`}>Calls</Link>
            {followups ? <Link href={`/portal/leads${q}`}>Leads</Link> : null}
            <Link href={`/portal/reports${q}`}>Reports</Link>
            <Link href={`/portal/billing${q}`}>Billing</Link>
            <Link href={`/portal/settings${q}`}>Your setup</Link>
          </nav>
          <form action="/api/auth/logout" method="post" className="text-xs text-slate-500">{email} · <button className="underline">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      {support ? <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 md:px-8">Questions about your receptionist or your bill? Email <a href={`mailto:${support}`}>{support}</a> or use “Request a change” under Your setup.</footer> : null}
    </div>
  );
}
