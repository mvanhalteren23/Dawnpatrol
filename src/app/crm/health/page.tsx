import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { healthBoard, type ClientRow } from "@/lib/client-health";
import { trend, type HealthStatus } from "@/lib/client-health-rules";
import { formatDate } from "@/lib/utils";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const LOOK: Record<HealthStatus, { label: string; badge: string; bar: string }> = {
  attention: { label: "needs attention", badge: "bg-red-100 text-red-800", bar: "border-l-red-500" },
  watch: { label: "watch", badge: "bg-amber-100 text-amber-800", bar: "border-l-amber-400" },
  new: { label: "new", badge: "bg-sky-100 text-sky-800", bar: "border-l-sky-400" },
  healthy: { label: "healthy", badge: "bg-emerald-100 text-emerald-800", bar: "border-l-emerald-500" },
};

/** Calls per day for the last 14 days. */
function Spark({ daily }: { daily: number[] }) {
  const max = Math.max(1, ...daily);
  return (
    <div className="flex h-8 items-end gap-px" role="img" aria-label={`Calls per day, last 14 days: ${daily.join(", ")}`}>
      {daily.map((n, i) => <div key={i} title={`${n} call${n === 1 ? "" : "s"}`} className={`w-1.5 rounded-sm ${n ? "bg-dawn-500" : "bg-slate-200"}`} style={{ height: `${n ? Math.max(15, (n / max) * 100) : 8}%` }} />)}
    </div>
  );
}

function Minutes({ used, cap }: { used: number; cap: number }) {
  const pct = cap ? Math.round((used / cap) * 100) : 0;
  return (
    <div>
      <div className="text-sm font-medium">{used} <span className="font-normal text-slate-500">of {cap}</span></div>
      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-400" : "bg-dawn-500"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}

function Num({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-0.5">{children}</div></div>;
}

function Client({ r }: { r: ClientRow }) {
  const t = trend(r.stats.calls7, r.stats.callsPrev7);
  const answered = r.stats.calls30;
  return (
    <li className={`card border-l-4 ${LOOK[r.status].bar}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/crm/accounts/${r.accountId}`} className="text-base font-semibold">{r.account}</Link>
            <Badge className={LOOK[r.status].badge}>{LOOK[r.status].label}</Badge>
            {r.subscriptionStatus && r.subscriptionStatus !== "ACTIVE" ? <Badge>{r.subscriptionStatus.toLowerCase().replace("_", " ")}</Badge> : null}
          </div>
          <div className="text-xs text-slate-500">{r.agent}{r.number ? ` · ${r.number}` : " · no number of its own"} · live {r.liveDays} day{r.liveDays === 1 ? "" : "s"}</div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href={`/crm/receptionists/${r.receptionistId}`}>Receptionist</Link>
          <Link href={`/portal?account=${r.accountId}`}>Their portal</Link>
        </div>
      </div>
      {r.reasons.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {r.reasons.map((x, i) => <li key={i} className="flex gap-2"><span aria-hidden className={x.level === "attention" ? "text-red-600" : "text-amber-500"}>●</span><span>{x.text}</span></li>)}
        </ul>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Num label="Calls, 7 days"><span className="text-sm font-medium">{r.stats.calls7}</span>{t ? <span className={`ml-1 text-xs ${t.startsWith("-") ? "text-red-700" : "text-slate-500"}`}>{t}</span> : null}</Num>
        <Num label="Last 14 days"><Spark daily={r.stats.daily} /></Num>
        <Num label="Minutes this month"><Minutes used={r.stats.minutesMonth} cap={r.includedMinutes} /></Num>
        <Num label="Last 30 days"><span className="text-sm">{answered} calls · {Math.max(r.stats.booked30, r.bookings30)} booked · {r.stats.messages30} messages</span>{r.stats.spam30 ? <div className="text-xs text-slate-500">{r.stats.spam30} spam screened</div> : null}</Num>
        <Num label="Unanswered questions"><span className={`text-sm font-medium ${r.openQuestions >= 3 ? "text-amber-700" : ""}`}>{r.openQuestions}</span>{r.topQuestion ? <div className="max-w-[14rem] truncate text-xs text-slate-500" title={r.topQuestion}>&ldquo;{r.topQuestion}&rdquo;</div> : null}</Num>
        <Num label="Leads not handled"><span className={`text-sm font-medium ${r.unhandledLeads >= 3 ? "text-amber-700" : ""}`}>{r.unhandledLeads}</span></Num>
        <Num label="Last call / portal sign-in"><span className="text-xs">{r.lastCallAt ? formatDate(r.lastCallAt, true) : "no calls yet"}<br />{r.lastPortalLoginAt ? formatDate(r.lastPortalLoginAt) : r.hasPortalUser ? "never signed in" : "no portal login"}</span></Num>
      </div>
    </li>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const session = await requireStaff();
  const board = await healthBoard(session.role === "ADMIN" ? null : session.sub);
  const show = (["attention", "watch", "healthy", "new"] as const).find((s) => s === sp.show);
  const rows = show ? board.rows.filter((r) => r.status === show) : board.rows;
  const t = board.totals;
  const callTrend = trend(t.calls7, t.callsPrev7);
  const count = (s: HealthStatus) => board.rows.filter((r) => r.status === s).length;
  return (
    <div>
      <PageHeader
        title="Client health"
        subtitle={`Every live client line: who needs a call, how much they're using it, and what's waiting on them. Lines last checked ${board.lineCheckAt ? formatDate(board.lineCheckAt, true) : "never (runs daily)"}.`}
        actions={session.role === "ADMIN" ? <Link href="/crm/launch" className="btn-secondary">Platform &amp; line check</Link> : undefined}
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Live clients" value={t.clients} sub={t.mrrCents ? `$${(t.mrrCents / 100).toLocaleString("en-US")} a month` : undefined} />
        <Stat label="Need attention" value={t.attention} sub={`${t.watch} to watch`} />
        <Stat label="Calls, last 7 days" value={t.calls7} sub={callTrend ? `${callTrend} on the week before` : undefined} />
        <Stat label="Minutes this month" value={t.minutesMonth} />
        <Stat label="Booked, last 30 days" value={t.booked30} />
        <Stat label="Waiting on owners" value={t.openQuestions + t.unhandledLeads} sub={`${t.openQuestions} questions · ${t.unhandledLeads} leads`} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/crm/health" className={!show ? "font-semibold" : "text-slate-500"}>All ({board.rows.length})</Link>
        {(["attention", "watch", "new", "healthy"] as const).map((s) => <Link key={s} href={`/crm/health?show=${s}`} className={show === s ? "font-semibold" : "text-slate-500"}>{LOOK[s].label} ({count(s)})</Link>)}
      </div>
      {!board.rows.length ? <Empty>No live client lines yet. A client appears here once their receptionist is in production.</Empty> : !rows.length ? <Empty>No clients with this status.</Empty> : <ul className="space-y-4">{rows.map((r) => <Client key={r.receptionistId} r={r} />)}</ul>}
    </div>
  );
}
