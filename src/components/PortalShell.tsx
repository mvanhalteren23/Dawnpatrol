import Link from "next/link";
import type { ReactNode } from "react";
import { companyName } from "@/lib/brand";

export async function PortalShell({ accountName, adminAccountId, email, children }: { accountName: string; adminAccountId?: string; email: string; children: ReactNode }) {
  const q = adminAccountId ? `?account=${adminAccountId}` : "";
  const company = await companyName();
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
            <Link href={`/portal/reports${q}`}>Reports</Link>
            <Link href={`/portal/billing${q}`}>Billing</Link>
            <Link href={`/portal/settings${q}`}>Your setup</Link>
          </nav>
          <form action="/api/auth/logout" method="post" className="text-xs text-slate-500">{email} · <button className="underline">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
    </div>
  );
}
