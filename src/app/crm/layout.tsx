import { requireStaff } from "@/lib/auth";
import { NavLink } from "@/components/ui";
import { companyName } from "@/lib/brand";
import { db } from "@/lib/db";

// Claude research, prospecting and KB drafting run in after() from this segment's server actions.
export const maxDuration = 300;

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const [session, company] = await Promise.all([requireStaff(), companyName()]);
  const isAdmin = session.role === "ADMIN";
  // Reps see review notices for their own accounts and unassigned ones; admins see all.
  const toReview = await db.account.findMany({ where: { needsReview: true, ...(isAdmin ? {} : { OR: [{ ownerId: session.sub }, { ownerId: null }] }) }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 5 });
  const nav: [string, string, string][] = [
    ["/crm", "Dashboard", "Home"],
    ["/crm/accounts", "Accounts", "Accounts"],
    ["/crm/pipeline", "Pipeline", "Pipeline"],
    ["/crm/team", "Team", "Team"],
    ["/crm/outreach", "Outreach", "Outreach"],
    ["/crm/dialer", "Dialer", "Dialer"],
    ["/crm/prospecting", "Prospecting (Claude)", "Prospect"],
    ["/crm/audits", "Call audits", "Audits"],
    ["/crm/prompts", "Saved prompts", "Prompts"],
    ...(isAdmin
      ? ([
          ["/crm/receptionists", "Receptionists & RAG", "RAG"],
          ["/crm/demo-line", "Demo line", "Demo"],
          ["/crm/billing", "Billing", "Billing"],
        ] as [string, string, string][])
      : []),
    ["/crm/settings", "Settings", "Settings"],
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col bg-dawn-900 p-4 md:flex">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold text-white">🌅 {company}</div>
          <div className="text-xs text-indigo-200">CRM</div>
        </div>
        <nav className="space-y-1">
          {nav.map(([href, label]) => <NavLink key={href} href={href}>{label}</NavLink>)}
        </nav>
        <div className="mt-auto px-3 pt-6 text-xs text-indigo-200">
          <div className="truncate">{session.email}</div>
          <div className="text-indigo-300">{isAdmin ? "Administrator" : "Sales rep"}</div>
          <form action="/api/auth/logout" method="post">
            <button className="mt-1 text-indigo-100 underline">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex-1">
        <div className="flex items-center gap-3 overflow-x-auto bg-dawn-900 px-4 py-2 text-sm md:hidden">
          {nav.map(([href, , label]) => (
            <a key={href} href={href} className="whitespace-nowrap text-indigo-100">{label}</a>
          ))}
        </div>
        {toReview.length ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            🔔 {toReview.length === 1 ? "1 account" : `${toReview.length}${toReview.length === 5 ? "+" : ""} accounts`} added or updated from receptionist bookings — review and edit as needed:{" "}
            {toReview.map((a, i) => <span key={a.id}>{i ? ", " : ""}<a href={`/crm/accounts/${a.id}`} className="font-medium text-amber-900 underline">{a.name}</a></span>)}
          </div>
        ) : null}
        <main className="mx-auto max-w-7xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
