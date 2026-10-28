import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PROSPECT_STAGES, STAGE_LABELS } from "@/lib/constants";
import { teamReport, type RepRow } from "@/lib/team-report";
import { STAGE_PROBABILITY } from "@/lib/team-rules";
import { formatDate, formatMoney } from "@/lib/utils";
import { Empty, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const PERIODS: Record<string, { label: string; since: () => Date }> = {
  today: { label: "Today", since: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; } },
  "7": { label: "Last 7 days", since: () => new Date(Date.now() - 7 * 86400_000) },
  month: { label: "This month", since: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); } },
  "30": { label: "Last 30 days", since: () => new Date(Date.now() - 30 * 86400_000) },
  "90": { label: "Last 90 days", since: () => new Date(Date.now() - 90 * 86400_000) },
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ period?: string; rep?: string }> }) {
  const sp = await searchParams;
  const session = await requireStaff();
  const period = PERIODS[sp.period ?? ""] ? sp.period! : "7";
  const since = PERIODS[period]!.since();
  const { rows, unassigned, total, dealMrr } = await teamReport(since);
  const rep = sp.rep && (sp.rep === "unassigned" || rows.some((r) => r.id === sp.rep)) ? sp.rep : "";
  const feed = await db.activity.findMany({
    where: { occurredAt: { gte: since }, type: { notIn: ["STAGE_CHANGE"] }, source: { not: "system" }, ...(rep === "unassigned" ? { createdById: null } : rep ? { createdById: rep } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 40,
    include: { account: { select: { id: true, name: true } }, createdBy: { select: { name: true, email: true } } },
  });
  const q = (p: Record<string, string>) => `/crm/team?${new URLSearchParams({ period, ...(rep ? { rep } : {}), ...p }).toString()}`;
  const me = rows.find((r) => r.id === session.sub);

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle={`Activity ${PERIODS[period]!.label.toLowerCase()} · pipeline and forecast as of now`}
        actions={session.role === "ADMIN" ? <Link href="/crm/settings/users" className="btn-secondary">Manage users</Link> : null}
      />
      <div className="mb-4 flex flex-wrap gap-1 text-sm">
        {Object.entries(PERIODS).map(([k, v]) => (
          <Link key={k} href={q({ period: k })} className={`rounded-full border px-3 py-1 hover:no-underline ${k === period ? "border-dawn-600 bg-dawn-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{v.label}</Link>
        ))}
      </div>

      {me ? (
        <div className="mb-6">
          <h2 className="mb-2">You</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Calls" value={me.calls} sub={`${me.conversations} conversations`} />
            <Stat label="Emails sent" value={me.emails} sub={`${me.replies} replies`} />
            <Stat label="Meetings" value={me.meetings} />
            <Stat label="Won" value={me.won} />
            <Stat label="Accounts" value={me.accounts} sub={`${me.openPipeline} in pipeline`} />
            <Stat label="Open tasks" value={me.openTasks} sub={me.overdueTasks ? `${me.overdueTasks} overdue` : "none overdue"} />
            <Stat label="Your MRR" value={formatMoney(me.mrrCents)} />
            <Stat label="Your forecast" value={formatMoney(me.forecastCents)} sub="weighted MRR" />
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Team MRR" value={formatMoney(total.mrrCents)} sub={`ARR ${formatMoney(total.mrrCents * 12)}`} />
        <Stat label="Forecast (weighted)" value={formatMoney(total.forecastCents)} sub="new MRR expected from open pipeline" />
        <Stat label="Commit" value={formatMoney(total.commitCents)} sub="Demo + Proposal + Onboarding at full value" />
        <Stat label="Team activity" value={total.calls + total.emails} sub={`${total.calls} calls · ${total.emails} emails · ${total.meetings} meetings`} />
      </div>

      <div className="card mb-6 overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th><th>Calls</th><th>Convos</th><th>Emails</th><th>Replies</th><th>Meetings</th><th>Won</th>
              <th>Accounts</th><th>Pipeline</th><th>Tasks</th><th>MRR</th><th>Forecast</th>
            </tr>
          </thead>
          <tbody>
            {[...rows, unassigned].map((r) => <Row key={r.id ?? "none"} r={r} me={session.sub} href={q({ rep: r.id ?? "unassigned" })} />)}
            <tr className="bg-slate-50 font-semibold"><td>Team total</td><Cells r={total} /></tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h2 className="mb-1">Pipeline by person</h2>
          <p className="mb-3 text-xs text-slate-500">Forecast = accounts × chance to close at each stage × expected MRR ({dealMrr ? `${formatMoney(dealMrr)}/mo: ` : ""}{dealMrr ? "average of current paying clients, or your cheapest plan" : "add a plan on Billing to value the forecast"}).</p>
          <table className="table text-xs">
            <thead><tr><th></th>{[...PROSPECT_STAGES, "ONBOARDING"].map((s) => <th key={s}>{STAGE_LABELS[s as keyof typeof STAGE_LABELS]}<div className="font-normal text-slate-400">{Math.round((STAGE_PROBABILITY[s] ?? 0) * 100)}%</div></th>)}</tr></thead>
            <tbody>
              {[...rows, unassigned, total].map((r) => (
                <tr key={r.id ?? "none"} className={r === total ? "bg-slate-50 font-semibold" : ""}>
                  <td>{r.name}</td>
                  {[...PROSPECT_STAGES, "ONBOARDING"].map((s) => (
                    <td key={s}>{r.id && r !== total ? <Link href={`/crm/accounts?owner=${r.id}&stage=${s}`}>{r.byStage[s] ?? 0}</Link> : r.byStage[s] ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2>Activity {rep ? `· ${rep === "unassigned" ? "automated / unassigned" : rows.find((r) => r.id === rep)?.name}` : "· everyone"}</h2>
            {rep ? <Link href={`/crm/team?period=${period}`} className="text-xs">Show everyone</Link> : null}
          </div>
          {feed.length ? (
            <ul className="divide-y divide-slate-100">
              {feed.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span><b>{a.createdBy ? a.createdBy.name || a.createdBy.email : "Automated"}</b> · {a.type.toLowerCase()}{a.outcome ? ` (${a.outcome.replace("_", " ")})` : ""} — <Link href={`/crm/accounts/${a.account.id}`}>{a.account.name}</Link></span>
                    <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(a.occurredAt, true)}</span>
                  </div>
                  {a.subject ? <div className="truncate text-xs text-slate-500">{a.subject}</div> : null}
                </li>
              ))}
            </ul>
          ) : <Empty>No activity in this period.</Empty>}
        </div>
      </div>
    </div>
  );
}

function Row({ r, me, href }: { r: RepRow; me: string; href: string }) {
  return (
    <tr className={r.id === me ? "bg-dawn-50" : ""}>
      <td>
        <Link href={href} className="font-medium">{r.name}</Link>{r.id === me ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
        <div className="text-xs text-slate-500">{r.id ? (r.role === "ADMIN" ? "Administrator" : r.role === "REP" ? "Sales rep" : r.role) : "Automated + no owner"}</div>
      </td>
      <Cells r={r} />
    </tr>
  );
}

function Cells({ r }: { r: RepRow }) {
  return (
    <>
      <td>{r.calls}</td>
      <td>{r.conversations}</td>
      <td>{r.emails}</td>
      <td>{r.replies}</td>
      <td>{r.meetings}</td>
      <td>{r.won}</td>
      <td>{r.id && r.id !== "__none__" ? <Link href={`/crm/accounts?owner=${r.id}`}>{r.accounts}</Link> : r.id === null ? <Link href="/crm/accounts?owner=unassigned">{r.accounts}</Link> : r.accounts}</td>
      <td>{r.openPipeline}</td>
      <td className={r.overdueTasks ? "text-red-600" : ""}>{r.openTasks}{r.overdueTasks ? ` (${r.overdueTasks} late)` : ""}</td>
      <td>{formatMoney(r.mrrCents)}</td>
      <td>{formatMoney(r.forecastCents)}</td>
    </>
  );
}
