import { requireAdmin } from "@/lib/auth";
import { NavLink } from "@/components/ui";
import { companyName } from "@/lib/brand";

// Claude research, prospecting and KB drafting run in after() from this segment's server actions.
export const maxDuration = 300;

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const [session, company] = await Promise.all([requireAdmin(), companyName()]);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col bg-dawn-900 p-4 md:flex">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold text-white">🌅 {company}</div>
          <div className="text-xs text-indigo-200">CRM</div>
        </div>
        <nav className="space-y-1">
          <NavLink href="/crm">Dashboard</NavLink>
          <NavLink href="/crm/accounts">Accounts</NavLink>
          <NavLink href="/crm/pipeline">Pipeline</NavLink>
          <NavLink href="/crm/outreach">Outreach</NavLink>
          <NavLink href="/crm/prospecting">Prospecting (Claude)</NavLink>
          <NavLink href="/crm/prompts">Saved prompts</NavLink>
          <NavLink href="/crm/receptionists">Receptionists & RAG</NavLink>
          <NavLink href="/crm/demo-line">Demo line</NavLink>
          <NavLink href="/crm/billing">Billing</NavLink>
          <NavLink href="/crm/settings">Settings</NavLink>
        </nav>
        <div className="mt-auto px-3 pt-6 text-xs text-indigo-200">
          <div className="truncate">{session.email}</div>
          <form action="/api/auth/logout" method="post">
            <button className="mt-1 text-indigo-100 underline">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex-1">
        <div className="flex items-center gap-3 overflow-x-auto bg-dawn-900 px-4 py-2 text-sm md:hidden">
          {[["/crm", "Home"], ["/crm/accounts", "Accounts"], ["/crm/pipeline", "Pipeline"], ["/crm/outreach", "Outreach"], ["/crm/prospecting", "Prospect"], ["/crm/receptionists", "RAG"], ["/crm/demo-line", "Demo"], ["/crm/billing", "Billing"], ["/crm/settings", "Settings"]].map(([href, label]) => (
            <a key={href} href={href} className="whitespace-nowrap text-indigo-100">{label}</a>
          ))}
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
