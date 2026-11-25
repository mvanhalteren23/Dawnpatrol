import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate } from "@/lib/utils";
import { coachStats } from "@/lib/coach";
import { COACH_TIMEFRAMES, PRACTICE_SCENARIOS, SCRIPT_REVIEW_MIN_CALLS, scriptReviewReady } from "@/lib/coach-rules";
import { retireScript, reviewCalls, reviewPatterns, reviewScript, saveScript, startPracticeCall } from "./actions";

export const dynamic = "force-dynamic";
// Coach reviews read many calls with an AI model; give them time.
export const maxDuration = 300;

const TABS = [
  ["overview", "Overview"],
  ["scripts", "Script lab"],
  ["review", "Call coaching"],
  ["patterns", "Objections & openers"],
  ["practice", "Practice"],
] as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function CoachPage({ searchParams }: { searchParams: Promise<{ tab?: string; notice?: string; error?: string; edit?: string }> }) {
  const session = await requireStaff();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const isAdmin = session.role === "ADMIN";
  const [scripts, reviews, team, { stats, best, calls }] = await Promise.all([
    db.callScript.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }] }),
    db.coachReview.findMany({ where: isAdmin ? {} : { createdById: session.sub }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, kind: true, title: true, status: true, createdAt: true } }),
    isAdmin ? db.user.findMany({ where: { role: { in: ["ADMIN", "REP"] }, disabled: false }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    coachStats({ days: 30, userId: isAdmin ? null : session.sub }),
  ]);
  const names = new Map(scripts.map((s) => [s.id, s.name]));
  const allTime = await coachStats({ days: 365, userId: null });
  const callsByScript = new Map(allTime.stats.map((s) => [s.scriptId, s.calls]));
  const editing = sp.edit ? scripts.find((s) => s.id === sp.edit) : null;

  const scopeFields = (
    <>
      <label className="text-sm">Timeframe
        <select name="days" defaultValue="14" className="input mt-1">{COACH_TIMEFRAMES.map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
      </label>
      {isAdmin ? (
        <label className="text-sm">Whose calls
          <select name="rep" defaultValue="all" className="input mt-1">
            <option value="all">Everyone</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
          </select>
        </label>
      ) : null}
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Sales coach" subtitle="Learns from your recorded dialer calls: test scripts, get feedback on what's working, build your objection playbook, and practise." />
      <Flash params={sp} />
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 text-sm" aria-label="Coach">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/crm/coach?tab=${k}`} className={`whitespace-nowrap border-b-2 px-3 py-2 hover:no-underline ${tab === k ? "border-dawn-600 font-semibold text-dawn-700" : "border-transparent text-slate-600"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card space-y-3 lg:col-span-2">
            <h2>Scripts, last 30 days{isAdmin ? "" : " (your calls)"}</h2>
            {stats.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Script</th><th>Calls</th><th>Conversations</th><th>Meetings</th><th>Interested</th><th>Closed deals</th></tr></thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.scriptId ?? "none"}>
                        <td className="font-medium">{s.scriptId ? names.get(s.scriptId) ?? "—" : <span className="text-slate-500">No script</span>}{best?.scriptId === s.scriptId && s.scriptId ? <Badge className="ml-2 bg-emerald-100 text-emerald-800">best</Badge> : null}</td>
                        <td>{s.calls}</td>
                        <td>{s.connected} <span className="text-xs text-slate-500">({pct(s.connectRate)})</span></td>
                        <td>{s.meetings} <span className="text-xs text-slate-500">({pct(s.meetingRate)} of convos)</span></td>
                        <td>{s.interested}</td>
                        <td>{s.deals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No dialer calls in the last 30 days yet.</Empty>}
            <p className="text-xs text-slate-500">{calls.length} calls. Closed deals count for the last script used before the account became a client. &ldquo;Best&rdquo; needs at least 5 conversations.</p>
          </div>
          <div className="card space-y-3">
            <h2>What would you like to do?</h2>
            <ul className="space-y-2 text-sm">
              <li><Link href="/crm/coach?tab=scripts" className="font-semibold">Script lab →</Link><div className="text-xs text-slate-500">Write scripts, test them in the dialer, and after {SCRIPT_REVIEW_MIN_CALLS} calls get 1-2 new approaches.</div></li>
              <li><Link href="/crm/coach?tab=review" className="font-semibold">Call coaching →</Link><div className="text-xs text-slate-500">What worked, what didn&apos;t, and which script or approach books the most meetings and closes deals.</div></li>
              <li><Link href="/crm/coach?tab=patterns" className="font-semibold">Objections &amp; openers →</Link><div className="text-xs text-slate-500">The objections you hear most and the answers that worked; which first lines keep people talking.</div></li>
              <li><Link href="/crm/coach?tab=practice" className="font-semibold">Practice →</Link><div className="text-xs text-slate-500">Role-play a call with an AI prospect, then get scored feedback.</div></li>
              <li><span className="font-semibold">Coach one call</span><div className="text-xs text-slate-500">On any recorded call in an account&apos;s timeline, press &ldquo;Coach this call&rdquo;.</div></li>
            </ul>
          </div>
          <div className="card space-y-2 lg:col-span-3">
            <h2>Recent coaching</h2>
            {reviews.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {reviews.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/crm/coach/${r.id}`}>{r.title}</Link>
                    <span className="text-xs text-slate-500">{r.status === "FAILED" ? <Badge className="bg-red-100 text-red-800">failed</Badge> : r.status === "RUNNING" && r.kind === "practice" ? <Badge className="bg-sky-100 text-sky-800">in progress</Badge> : null} {formatDate(r.createdAt, true)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No coaching yet.</Empty>}
          </div>
        </div>
      ) : null}

      {tab === "scripts" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            {scripts.length ? scripts.map((s) => {
              const n = callsByScript.get(s.id) ?? 0;
              const ready = scriptReviewReady(n);
              return (
                <div key={s.id} className={`card space-y-2 ${s.status === "retired" ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{s.name}</h3>
                    <Badge className={s.status === "testing" ? "bg-sky-100 text-sky-800" : s.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}>{s.status}</Badge>
                  </div>
                  {s.notes ? <p className="text-xs text-slate-500">{s.notes}</p> : null}
                  <details><summary className="cursor-pointer text-sm">Read the script</summary><div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{s.body}</div></details>
                  <div className="text-xs text-slate-600">{n} call{n === 1 ? "" : "s"} made with it{ready.ready ? "" : ` · ${ready.remaining} more before the coach can review it`}</div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-dawn-600" style={{ width: `${Math.min(100, (n / SCRIPT_REVIEW_MIN_CALLS) * 100)}%` }} /></div>
                  <div className="flex flex-wrap gap-2">
                    <form action={reviewScript.bind(null, s.id)}><SubmitButton className="btn py-1 text-sm" pendingText="The coach is reading your calls…" disabled={!ready.ready}>Ask the coach for new approaches</SubmitButton></form>
                    <Link href={`/crm/coach?tab=scripts&edit=${s.id}`} className="btn-secondary py-1 text-sm hover:no-underline">Edit</Link>
                    {s.status !== "retired" ? <form action={retireScript.bind(null, s.id)}><button className="btn-secondary py-1 text-sm">Retire</button></form> : null}
                  </div>
                </div>
              );
            }) : <Empty>No scripts yet. Write your first one, then pick it in the dialer.</Empty>}
          </div>
          <form action={saveScript} className="card space-y-3 self-start">
            <h2>{editing ? `Edit "${editing.name}"` : "New script"}</h2>
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <label className="block text-sm">Name<input name="name" defaultValue={editing?.name ?? ""} placeholder="e.g. Missed-call cost opener" className="input mt-1" required maxLength={80} /></label>
            <label className="block text-sm">What to say
              <textarea name="body" defaultValue={editing?.body ?? ""} rows={12} className="input mt-1 font-mono text-sm" required maxLength={6000} placeholder={"Opener: Hi, is this the owner? It's [name] from Head Above Digital. Quick question: what happens when someone calls while you're on a job?\n\nQuestions:\n- How many calls do you think go to voicemail in a week?\n- What's a typical job worth?\n\nPitch: ...\n\nIf they say \"we're fine\": ...\n\nClose: Could I show you a 15-minute demo answering as your business?"} />
            </label>
            <label className="block text-sm">Status
              <select name="status" defaultValue={editing?.status ?? "testing"} className="input mt-1">
                <option value="testing">Testing</option>
                <option value="active">Active (the main script)</option>
                <option value="retired">Retired</option>
              </select>
            </label>
            <SubmitButton className="btn">{editing ? "Save script" : "Add script"}</SubmitButton>
            <p className="text-xs text-slate-500">In the dialer, choose the script before you call: every call is tagged with it, and the script shows on screen while you talk.</p>
          </form>
        </div>
      ) : null}

      {tab === "review" ? (
        <form action={reviewCalls} className="card max-w-2xl space-y-3">
          <h2>Call coaching</h2>
          <p className="text-sm text-slate-600">The coach reads your recorded calls in the timeframe (up to the 60 newest, with their transcripts and outcomes) and the numbers per script, then tells you what worked, what didn&apos;t, and which script or approach is booking the most meetings and closing deals.</p>
          <div className="grid gap-3 sm:grid-cols-2">{scopeFields}</div>
          <SubmitButton className="btn" pendingText="The coach is reviewing your calls (about a minute)…">Review my calls</SubmitButton>
        </form>
      ) : null}

      {tab === "patterns" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={reviewPatterns.bind(null, "objections")} className="card space-y-3">
            <h2>Objection playbook</h2>
            <p className="text-sm text-slate-600">The objections prospects raise most, and the answers that actually led to a meeting, word for word.</p>
            <div className="grid gap-3 sm:grid-cols-2">{scopeFields}</div>
            <SubmitButton className="btn" pendingText="Reading your calls…">Build the playbook</SubmitButton>
          </form>
          <form action={reviewPatterns.bind(null, "openers")} className="card space-y-3">
            <h2>Openers</h2>
            <p className="text-sm text-slate-600">Which first lines keep people on the phone, which lose them, and a new opener to try.</p>
            <div className="grid gap-3 sm:grid-cols-2">{scopeFields}</div>
            <SubmitButton className="btn" pendingText="Reading your calls…">Compare openers</SubmitButton>
          </form>
        </div>
      ) : null}

      {tab === "practice" ? (
        <form action={startPracticeCall} className="card max-w-2xl space-y-3">
          <h2>Practice call</h2>
          <p className="text-sm text-slate-600">The coach plays a small-business owner who just picked up your call. Type what you&apos;d say; when you&apos;re done, end the call for a score and feedback. Nothing is logged on any account.</p>
          <div className="space-y-2">
            {PRACTICE_SCENARIOS.map((s, i) => (
              <label key={s.key} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="radio" name="scenario" value={s.key} defaultChecked={i === 0} className="mt-1" />
                <span><b>{s.label}</b><span className="block text-xs text-slate-500">{s.brief}</span></span>
              </label>
            ))}
          </div>
          <SubmitButton className="btn" pendingText="Dialling…">Start the practice call</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
