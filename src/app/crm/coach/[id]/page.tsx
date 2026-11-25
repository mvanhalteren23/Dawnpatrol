import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate, safeJson } from "@/lib/utils";
import type { CoachApproaches, CoachCallReview, CoachObjections, CoachOpeners, CoachSingleCall, PracticeFeedback } from "@/lib/ai";
import type { ScriptStat } from "@/lib/coach-rules";
import type { PracticeState } from "@/lib/coach";
import { adoptApproach, endPractice, practiceTurn } from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const pct = (n: number) => `${Math.round(n * 100)}%`;

function List({ title, items }: { title: string; items: React.ReactNode[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="label">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export default async function CoachReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireStaff();
  const { id } = await params;
  const r = await db.coachReview.findUnique({ where: { id } });
  if (!r || (session.role !== "ADMIN" && r.createdById !== session.sub)) notFound();
  const names = new Map((await db.callScript.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  const res = safeJson<Record<string, unknown>>(r.result, {});

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={r.title} subtitle={`${formatDate(r.createdAt, true)} · Sales coach`} />
      <Flash params={await searchParams} />
      <Link href="/crm/coach" className="text-sm">← Coach</Link>
      {r.status === "FAILED" ? <Notice kind="error">{r.error}</Notice> : null}

      {r.kind === "calls" && r.status === "DONE" ? (() => {
        const x = res as { review: CoachCallReview; stats: ScriptStat[]; best: string | null; calls: number };
        return (
          <div className="space-y-4">
            <div className="card space-y-4">
              <p className="text-lg font-semibold text-dawn-800">{x.review.headline}</p>
              <List title="What worked" items={x.review.worked.map((w) => <>{w.point} <span className="text-slate-500">({w.evidence})</span></>)} />
              <List title="What didn't" items={x.review.didnt.map((d) => <>{d.point} <span className="text-slate-500">({d.evidence})</span><div className="text-emerald-800">Instead: {d.fix}</div></>)} />
              <div className="rounded-lg bg-emerald-50 p-3"><div className="label">Best script or approach</div><div className="font-semibold">{x.review.bestApproach.name}</div><p className="text-sm">{x.review.bestApproach.why}</p></div>
              <List title="Practise next" items={x.review.focus} />
            </div>
            <StatsTable stats={x.stats} names={names} best={x.best} note={`${x.calls} calls`} />
          </div>
        );
      })() : null}

      {r.kind === "script" && r.status === "DONE" ? (() => {
        const x = res as CoachApproaches & { stats: ScriptStat | null };
        return (
          <div className="space-y-4">
            <div className="card space-y-2">
              <div className="label">How it&apos;s doing</div>
              <p className="text-sm">{x.verdict}</p>
              {x.stats ? <p className="text-xs text-slate-500">{x.stats.calls} calls · {x.stats.connected} conversations ({pct(x.stats.connectRate)}) · {x.stats.meetings} meetings ({pct(x.stats.meetingRate)}) · {x.stats.deals} closed deals</p> : null}
            </div>
            {x.approaches.map((a, i) => (
              <div key={i} className="card space-y-3">
                <h2>New approach {i + 1}: {a.name}</h2>
                <p className="text-sm text-slate-700">{a.idea}</p>
                <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{a.script}</div>
                <form action={adoptApproach.bind(null, r.id, i)}><SubmitButton className="btn">Save as a new script to test</SubmitButton></form>
              </div>
            ))}
          </div>
        );
      })() : null}

      {r.kind === "call" && r.status === "DONE" ? (() => {
        const x = res as CoachSingleCall;
        const p = safeJson<{ accountId?: string }>(r.params, {});
        return (
          <div className="card space-y-4">
            <p className="text-sm">{x.summary}</p>
            <List title="Done well" items={x.strengths} />
            <List title="Better next time" items={x.improvements.map((m) => <>{m.moment}<div className="text-emerald-800">Say: &ldquo;{m.better}&rdquo;</div></>)} />
            <div><div className="label">Next step</div><p className="text-sm">{x.nextStep}</p></div>
            {p.accountId ? <Link href={`/crm/accounts/${p.accountId}`} className="text-sm">Open the account →</Link> : null}
          </div>
        );
      })() : null}

      {r.kind === "objections" && r.status === "DONE" ? (
        <div className="space-y-3">
          {(res as CoachObjections).objections.map((o, i) => (
            <div key={i} className="card space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">&ldquo;{o.objection}&rdquo;</h3><span className="text-xs text-slate-500">{o.times} call{o.times === 1 ? "" : "s"}</span></div>
              <p className="text-sm"><span className="label">Best answer</span>{o.bestResponse}</p>
              {o.worked ? <Badge className="bg-emerald-100 text-emerald-800">worked on your calls</Badge> : <Badge className="bg-amber-100 text-amber-900">suggested (nothing worked yet)</Badge>}
            </div>
          ))}
        </div>
      ) : null}

      {r.kind === "openers" && r.status === "DONE" ? (() => {
        const x = res as CoachOpeners;
        return (
          <div className="space-y-3">
            {x.openers.map((o, i) => (
              <div key={i} className="card space-y-1">
                <h3 className="font-semibold">&ldquo;{o.opener}&rdquo;</h3>
                <p className="text-xs text-slate-500">{o.calls} calls · stayed on past 30s: {o.keptTalking}</p>
                <p className="text-sm">{o.verdict}</p>
              </div>
            ))}
            <div className="card bg-emerald-50"><div className="label">Try this opener</div><p className="text-base">&ldquo;{x.suggestion}&rdquo;</p></div>
          </div>
        );
      })() : null}

      {r.kind === "practice" ? <Practice id={r.id} state={res as unknown as PracticeState} running={r.status === "RUNNING"} error={r.error} /> : null}
    </div>
  );
}

function StatsTable({ stats, names, best, note }: { stats: ScriptStat[]; names: Map<string, string>; best: string | null; note: string }) {
  if (!stats.length) return null;
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-2">The numbers</h2>
      <table className="table">
        <thead><tr><th>Script</th><th>Calls</th><th>Conversations</th><th>Meetings</th><th>Closed deals</th></tr></thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.scriptId ?? "none"}>
              <td>{s.scriptId ? names.get(s.scriptId) ?? "—" : "No script"}{best && best === s.scriptId ? <Badge className="ml-2 bg-emerald-100 text-emerald-800">best</Badge> : null}</td>
              <td>{s.calls}</td><td>{s.connected} ({pct(s.connectRate)})</td><td>{s.meetings} ({pct(s.meetingRate)})</td><td>{s.deals}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function Practice({ id, state, running, error }: { id: string; state: PracticeState; running: boolean; error: string | null }) {
  const fb = state.feedback as PracticeFeedback | undefined;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <p className="text-xs text-slate-500">The prospect: {state.brief}</p>
        <ol className="space-y-2">
          {state.messages.map((m, i) => (
            <li key={i} className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "ml-auto bg-dawn-600 text-white" : "bg-slate-100 text-slate-900"}`}>
              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{m.role === "user" ? "You" : "Prospect"}</span>
              {m.content}
            </li>
          ))}
        </ol>
        <span id="end" />
        {running && !fb ? (
          <>
            <form action={practiceTurn.bind(null, id)} className="flex flex-col gap-2 sm:flex-row">
              <textarea name="say" rows={2} required maxLength={1000} placeholder="What do you say?" className="input flex-1" autoFocus />
              <SubmitButton className="btn sm:self-end" pendingText="…">Say it</SubmitButton>
            </form>
            <form action={endPractice.bind(null, id)}><SubmitButton className="btn-secondary" pendingText="Scoring the call…">End the call and get feedback</SubmitButton></form>
            {error ? <Notice kind="error">{error}</Notice> : null}
          </>
        ) : null}
      </div>
      {fb ? (
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><h2>Feedback</h2><span className="text-2xl font-bold text-dawn-700">{fb.score}/10</span></div>
          <p className="text-sm">{fb.outcome}</p>
          <List title="Done well" items={fb.strengths} />
          <List title="Better next time" items={fb.improvements.map((m) => <>{m.moment}<div className="text-emerald-800">Say: &ldquo;{m.better}&rdquo;</div></>)} />
          <Link href="/crm/coach?tab=practice" className="btn-secondary w-fit hover:no-underline">Practise again</Link>
        </div>
      ) : null}
    </div>
  );
}
