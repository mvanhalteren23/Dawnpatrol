import Link from "next/link";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { PROSPECT_STAGES, STAGE_LABELS, DEFAULT_CLIENT_GOAL } from "@/lib/constants";
import { computeMrr, conversionRate, goalProgress, payingSubscriptions, requiredPace } from "@/lib/metrics";
import { formatDate, formatMoney, safeJson } from "@/lib/utils";
import { PageHeader, Progress, Stat, StageBadge, StatusBadge, Empty } from "@/components/ui";
import { completeTask } from "./actions";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const now = new Date();
  const [subs, stageCounts, followUps, tasks, recent, missedCalls, goalRaw, wonCount, workedCount] = await Promise.all([
    db.subscription.findMany({ include: { account: true } }),
    db.account.groupBy({ by: ["stage"], _count: true }),
    db.account.findMany({ where: { stage: { in: PROSPECT_STAGES }, nextFollowUpAt: { lte: now } }, orderBy: { nextFollowUpAt: "asc" }, take: 10 }),
    db.activity.findMany({ where: { type: "TASK", completedAt: null }, orderBy: { dueAt: "asc" }, take: 10, include: { account: true } }),
    db.activity.findMany({ where: { type: { notIn: ["STAGE_CHANGE"] } }, orderBy: { occurredAt: "desc" }, take: 12, include: { account: true, contact: true } }),
    db.callLog.findMany({ where: { followUpNeeded: true, followedUpAt: null }, orderBy: { startedAt: "desc" }, take: 8, include: { receptionist: { include: { account: true } } } }),
    getSetting("goal.clients"),
    db.account.count({ where: { convertedAt: { not: null } } }),
    db.account.count({ where: { stage: { notIn: ["PROSPECT"] } } }),
  ]);
  const goal = safeJson<{ min: number; max: number; targetDate?: string }>(goalRaw, DEFAULT_CLIENT_GOAL);
  const paying = payingSubscriptions(subs);
  const mrr = computeMrr(subs);
  const progress = goalProgress(paying.length, goal);
  const pace = goal.targetDate ? requiredPace(paying.length, new Date(goal.targetDate), goal.min) : null;
  const counts = Object.fromEntries(stageCounts.map((s) => [s.stage, s._count]));
  const pipelineValue = PROSPECT_STAGES.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Goal: ${goal.min}–${goal.max} paying clients`} actions={<Link href="/crm/accounts/new" className="btn">+ New account</Link>} />

      <div className="card mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-sm text-slate-500">Paying clients</div>
            <div className="text-4xl font-semibold">{paying.length}<span className="text-lg text-slate-400"> / {goal.min}</span></div>
          </div>
          <div className="text-right text-sm text-slate-500">
            {progress.remainingToMin > 0 ? `${progress.remainingToMin} to go for ${goal.min}` : `Minimum goal hit — ${Math.max(0, goal.max - paying.length)} to stretch goal`}
            {pace != null ? <div>Need ~{pace} new clients / month to hit it by {formatDate(goal.targetDate!)}</div> : null}
          </div>
        </div>
        <div className="mt-3"><Progress pct={progress.pctOfMin} /></div>
        <div className="mt-1 text-xs text-slate-400">{progress.pctOfMax}% of stretch goal ({goal.max})</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="MRR" value={formatMoney(mrr)} sub={`ARR ${formatMoney(mrr * 12)}`} />
        <Stat label="Open pipeline" value={pipelineValue} sub={`${counts.DEMO ?? 0} demos · ${counts.PROPOSAL ?? 0} proposals`} />
        <Stat label="Win rate" value={`${conversionRate(wonCount, workedCount)}%`} sub="clients ÷ prospects worked" />
        <Stat label="Past due" value={counts.PAST_DUE ?? 0} sub={`${counts.CHURNED ?? 0} churned all-time`} />
      </div>

      <div className="mb-6 card">
        <h2 className="mb-3">Pipeline</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {(["PROSPECT", "CONTACTED", "ENGAGED", "DEMO", "PROPOSAL", "ONBOARDING", "ACTIVE", "PAST_DUE", "CHURNED", "LOST"] as const).map((s) => (
            <Link key={s} href={`/crm/accounts?stage=${s}`} className="rounded-lg border border-slate-200 p-2 text-center hover:bg-slate-50 hover:no-underline">
              <div className="text-xl font-semibold text-slate-900">{counts[s] ?? 0}</div>
              <div className="text-xs text-slate-500">{STAGE_LABELS[s]}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3">Follow-ups due</h2>
          {followUps.length ? (
            <ul className="divide-y divide-slate-100">
              {followUps.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/crm/accounts/${a.id}`}>{a.name}</Link>
                  <span className="flex items-center gap-2"><StageBadge stage={a.stage} /><span className="text-xs text-red-600">{formatDate(a.nextFollowUpAt)}</span></span>
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing due. 🎉</Empty>}
        </div>

        <div className="card">
          <h2 className="mb-3">Open tasks</h2>
          {tasks.length ? (
            <ul className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <div>{t.subject ?? "Task"}</div>
                    <Link href={`/crm/accounts/${t.accountId}`} className="text-xs">{t.account.name}</Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${t.dueAt && t.dueAt < now ? "text-red-600" : "text-slate-500"}`}>{formatDate(t.dueAt)}</span>
                    <form action={completeTask.bind(null, t.id, "/crm")}><button className="btn-secondary px-2 py-1 text-xs">Done</button></form>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No open tasks.</Empty>}
        </div>

        <div className="card">
          <h2 className="mb-3">Client calls needing follow-up</h2>
          {missedCalls.length ? (
            <ul className="divide-y divide-slate-100">
              {missedCalls.map((c) => (
                <li key={c.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <Link href={`/crm/receptionists/${c.receptionistId}`}>{c.receptionist.account.name}</Link>
                    <StatusBadge status={c.outcome} />
                  </div>
                  <div className="text-xs text-slate-500">{c.callerName ?? c.callerNumber ?? "Unknown caller"} · {formatDate(c.startedAt, true)}</div>
                  <div className="text-xs text-slate-600">{c.summary.slice(0, 160)}</div>
                </li>
              ))}
            </ul>
          ) : <Empty>Every caller handled.</Empty>}
        </div>

        <div className="card">
          <h2 className="mb-3">Recent activity</h2>
          {recent.length ? (
            <ul className="divide-y divide-slate-100">
              {recent.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span><span className="font-medium">{a.type.toLowerCase()}</span>{a.direction ? ` · ${a.direction.toLowerCase()}` : ""} — <Link href={`/crm/accounts/${a.accountId}`}>{a.account.name}</Link></span>
                    <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(a.occurredAt, true)}</span>
                  </div>
                  {a.subject ? <div className="truncate text-xs text-slate-500">{a.subject}</div> : null}
                </li>
              ))}
            </ul>
          ) : <Empty>No activity yet.</Empty>}
        </div>
      </div>
    </div>
  );
}
