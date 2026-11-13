import Link from "next/link";
import type { ReactNode } from "react";
import { companyName } from "@/lib/brand";
import { db } from "@/lib/db";
import { supportAddress } from "@/lib/google";
import { BrandMark } from "@/components/site/BrandLogo";
import { safeLogo } from "@/lib/email-brand";

export async function PortalShell({ accountId, accountName, adminAccountId, email, children }: { accountId: string; accountName: string; adminAccountId?: string; email: string; children: ReactNode }) {
  const q = adminAccountId ? `?account=${adminAccountId}` : "";
  const [company, followups, support, branded] = await Promise.all([
    companyName(),
    db.receptionist.count({ where: { accountId, agentType: "followup" } }),
    supportAddress().catch(() => null),
    // Their own logo (from their website or set under Your setup) makes the portal theirs.
    db.receptionist.findFirst({ where: { accountId, brandLogoUrl: { not: null } }, orderBy: [{ lifecycle: "desc" }, { createdAt: "asc" }], select: { brandLogoUrl: true } }),
  ]);
  const logo = safeLogo(branded?.brandLogoUrl);
  return (
    <div className="min-h-screen">
      {adminAccountId ? (
        <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900">Admin preview of {accountName}&apos;s portal · <Link href={`/crm/accounts/${adminAccountId}`}>back to CRM</Link></div>
      ) : null}
      <header className="border-b-4 border-dawn-700 bg-dawn-600 text-dawn-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={accountName} className="h-11 max-w-[140px] rounded-[8px] bg-white object-contain p-1" />
            ) : <BrandMark size={40} />}
            <div>
              <div className="font-condensed text-xl font-extrabold leading-tight text-dawn-100">{accountName}</div>
              <div className="font-condensed text-xs font-bold uppercase tracking-[0.18em] text-dawn-400">AI receptionist by {company}</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm [&_a]:font-semibold [&_a]:text-dawn-100 [&_a:hover]:text-dawn-400">
            <Link href={`/portal${q}`}>Overview</Link>
            <Link href={`/portal/knowledge${q}`}>What it knows</Link>
            <Link href={`/portal/calls${q}`}>Calls</Link>
            <Link href={`/portal/bookings${q}`}>Bookings</Link>
            <Link href={`/portal/photos${q}`}>Photos</Link>
            {followups ? <Link href={`/portal/leads${q}`}>Leads</Link> : null}
            <Link href={`/portal/reports${q}`}>Reports</Link>
            <Link href={`/portal/billing${q}`}>Billing</Link>
            <Link href={`/portal/settings${q}`}>Your setup</Link>
          </nav>
          <form action="/api/auth/logout" method="post" className="text-xs text-dawn-100/80">{email} · <button className="underline">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      {support ? <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 md:px-8">Questions about your receptionist or your bill? Email <a href={`mailto:${support}`}>{support}</a> or use “Request a change” under Your setup.</footer> : null}
    </div>
  );
}
