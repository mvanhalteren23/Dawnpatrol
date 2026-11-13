import { requireAdmin } from "@/lib/auth";
import { launchChecks, manualDone, MANUAL_ITEMS, type Check } from "@/lib/launch-check";
import { sortChecks, type CheckState } from "@/lib/launch-check-rules";
import { Badge, Notice, PageHeader, Stat } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { checkLinesNow, hideOldPlans, setBackupAnswering, toggleLaunchItem } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOK: Record<CheckState, { label: string; className: string }> = {
  ok: { label: "ready", className: "bg-emerald-100 text-emerald-800" },
  warn: { label: "check", className: "bg-amber-100 text-amber-800" },
  todo: { label: "to do", className: "bg-red-100 text-red-800" },
  unknown: { label: "couldn't check", className: "bg-slate-100 text-slate-700" },
};

function Row({ c }: { c: Check }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-slate-100 py-3 last:border-0">
      <Badge className={LOOK[c.state].className}>{LOOK[c.state].label}</Badge>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">{c.label} <span className="text-xs font-normal text-slate-500">· {c.area}</span></div>
        <div className="text-slate-600">{c.detail}</div>
        {c.fix ? <div className="mt-1 text-slate-800"><b>Fix:</b> {c.fix}</div> : null}
        {c.label === "Backup answering on every number" && c.state === "todo" ? <form action={setBackupAnswering} className="mt-2"><SubmitButton className="btn-secondary" pendingText="Setting…">Set backup answering on every number</SubmitButton></form> : null}
        {c.label === "Daily line check (no test call)" ? <form action={checkLinesNow} className="mt-2"><SubmitButton className="btn-secondary" pendingText="Checking…">Check all lines now</SubmitButton></form> : null}
        {c.label === "Old plans still on offer" ? <form action={hideOldPlans} className="mt-2"><SubmitButton className="btn-secondary" pendingText="Hiding…">Hide the old plans</SubmitButton></form> : null}
      </div>
    </li>
  );
}

export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const [checks, done] = await Promise.all([launchChecks(), manualDone()]);
  const sorted = sortChecks(checks);
  const blockers = checks.filter((c) => c.state === "todo").length;
  const warnings = checks.filter((c) => c.state === "warn" || c.state === "unknown").length;
  const yoursLeft = MANUAL_ITEMS.filter((m) => !done.has(m.key)).length;
  const areas = Array.from(new Set(MANUAL_ITEMS.map((m) => m.area)));
  return (
    <div>
      <PageHeader title="Launch check" subtitle="What's ready, and what's left before taking paying clients. The first list is checked live each time you open this page." />
      <Flash params={sp} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="To do (checked live)" value={blockers} />
        <Stat label="Worth a look" value={warnings} />
        <Stat label="Ready" value={checks.filter((c) => c.state === "ok").length} />
        <Stat label="Your side, not ticked" value={yoursLeft} />
      </div>
      {blockers === 0 && yoursLeft === 0 ? <Notice kind="success">Everything on this page is ready.</Notice> : null}
      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Checked live</h2>
        <ul>{sorted.map((c) => <Row key={`${c.area}-${c.label}`} c={c} />)}</ul>
      </section>
      <section className="card" id="yours">
        <h2 className="mb-1 font-semibold">Your side</h2>
        <p className="mb-3 text-sm text-slate-500">Paperwork and settings in other dashboards that this page can&apos;t see. Tick each one off when it&apos;s done.</p>
        {areas.map((area) => (
          <div key={area} className="mb-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{area}</div>
            <ul>
              {MANUAL_ITEMS.filter((m) => m.area === area).map((m) => {
                const isDone = done.has(m.key);
                return (
                  <li key={m.key} className="flex items-start gap-3 border-b border-slate-100 py-2 last:border-0">
                    <form action={toggleLaunchItem.bind(null, m.key, !isDone)}>
                      <button aria-label={isDone ? `Mark not done: ${m.label}` : `Mark done: ${m.label}`} className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border text-xs ${isDone ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-400 bg-white text-transparent"}`}>✓</button>
                    </form>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className={isDone ? "text-slate-500 line-through" : "font-medium"}>{m.label}</div>
                      {isDone ? null : <div className="text-slate-600">{m.help}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
