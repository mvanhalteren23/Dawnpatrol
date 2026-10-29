import type { AuditCall, CallAudit } from "@prisma/client";
import { formatSlot } from "@/lib/booking";
import { AUDIT_CALL_STATUSES, scenarioByKey, type AuditCallStatus } from "@/lib/audit-rules";
import { auditResults, parseAnalysis, parseReport, realCalls } from "@/lib/call-audit";
import { Badge } from "@/components/ui";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
const TONE: Partial<Record<AuditCallStatus, string>> = {
  ANSWERED: "bg-green-100 text-green-800",
  VOICEMAIL: "bg-amber-100 text-amber-800",
  NO_ANSWER: "bg-red-100 text-red-800",
  BUSY: "bg-red-100 text-red-800",
  FAILED: "bg-slate-200 text-slate-700",
};

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

/** The audit's numbers, written findings and the calls. `staff` adds transcripts and recordings. */
export function AuditReportView({ audit, calls, staff }: { audit: CallAudit; calls: AuditCall[]; staff: boolean }) {
  const real = realCalls(calls);
  const { stats: s, baseline: b } = auditResults(audit, calls);
  const report = parseReport(audit);
  const p = (x: number | null) => (x == null ? "—" : `${x}%`);

  return (
    <div className="space-y-6">
      {report ? (
        <div className="card space-y-2">
          <p className="text-lg font-semibold text-slate-900">{report.headline}</p>
          <p className="text-sm text-slate-700">{report.summary}</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Test calls placed" value={s.placed} sub={`${real.filter((c) => c.status === "PLANNED").length} still to go`} />
        <Tile label="Answered by a person" value={s.answered} sub={s.avgRingSeconds != null ? `after ${s.avgRingSeconds}s on average` : undefined} />
        <Tile label="Missed" value={`${s.missed}${s.missedPct != null ? ` (${s.missedPct}%)` : ""}`} sub={`${s.voicemail} voicemail · ${s.noAnswer} no answer · ${s.busy} busy`} />
        <Tile label="Missed during open hours" value={p(s.openHours.missedPct)} sub={`after hours: ${p(s.afterHours.missedPct)}`} />
      </div>

      <div className="card space-y-3">
        <h2>What missed calls are likely costing</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Missed calls" value={`~${b.missedPerWeek}/week`} sub={`about ${b.missedPerMonth} a month`} />
          <Tile label="Lost new jobs" value={`~${b.lostJobsPerMonth}/month`} />
          <Tile label="Revenue at risk" value={`${money(b.revenueAtRiskPerMonthCents)}/month`} />
        </div>
        <p className="text-xs text-slate-500">
          Estimate: this week&apos;s miss rates ({p(s.openHours.missedPct)} open hours, {s.afterHours.placed ? p(s.afterHours.missedPct) : "100% assumed"} after hours) applied to about {audit.callsPerWeek} calls a week ({Math.round(audit.afterHoursShare * 100)}% after hours).
          Of missed callers, {Math.round(audit.newCustomerShare * 100)}% assumed new customers, {Math.round(audit.bookingRate * 100)}% of whom would have booked, at an average job of {money(audit.avgJobValueCents)}. Based on {s.placed} test calls, so treat it as a guide, not a measurement.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3">By time of day</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2">When</th><th>Calls</th><th>Answered</th><th>Missed</th></tr></thead>
            <tbody>
              {s.byWindow.map((w) => (
                <tr key={w.window} className="border-t border-slate-100"><td className="py-1.5">{w.window}</td><td>{w.placed}</td><td>{w.answered}</td><td>{p(Math.round(((w.placed - w.answered) / w.placed) * 100))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="mb-3">How answered calls were handled</h2>
          {s.quality.analyzed ? (
            <ul className="space-y-1.5 text-sm">
              <li>Average score: <b>{s.quality.avgScore}/5</b> <span className="text-slate-500">(as a new customer would see it)</span></li>
              <li>Questions answered: <b>{p(s.quality.answeredQuestionsPct)}</b></li>
              <li>Offered to book a time: <b>{p(s.quality.offeredAppointmentPct)}</b></li>
              <li>Took the caller&apos;s name or number: <b>{p(s.quality.askedForContactPct)}</b></li>
              <li>Put on hold: <b>{p(s.quality.heldPct)}</b></li>
            </ul>
          ) : <p className="text-sm text-slate-500">Appears once answered calls are analysed.</p>}
        </div>
      </div>

      {report ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-2">
            <h2>Findings</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">{report.findings.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
          <div className="card space-y-2">
            <h2>Recommendations</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">{report.recommendations.map((f) => <li key={f}>{f}</li>)}</ul>
            {report.aiWouldHaveHandled.length ? (
              <>
                <h3 className="pt-2 text-sm font-semibold">What an AI receptionist would have done</h3>
                <ul className="list-disc space-y-1.5 pl-5 text-sm">{report.aiWouldHaveHandled.map((f) => <li key={f}>{f}</li>)}</ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2 className="mb-3">The calls</h2>
        <ul className="space-y-3 text-sm">
          {real.map((c) => {
            const a = parseAnalysis(c);
            return (
              <li key={c.id} className="border-b border-slate-100 pb-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatSlot(c.calledAt ?? c.scheduledAt, audit.timezone)}</span>
                  <Badge>{c.window}</Badge>
                  <Badge className={TONE[c.status as AuditCallStatus]}>{AUDIT_CALL_STATUSES[c.status as AuditCallStatus] ?? c.status}</Badge>
                  {c.ringSeconds != null && c.status !== "PLANNED" ? <span className="text-xs text-slate-500">picked up after {c.ringSeconds}s</span> : null}
                  {a ? <span className="ml-auto text-xs font-medium">{a.handledScore}/5</span> : null}
                </div>
                <div className="mt-1 text-slate-600">{scenarioByKey(audit.industry, audit.customScenarios, c.scenarioKey).title}{c.note ? <span className="text-xs text-slate-400"> · {c.note}</span> : null}</div>
                {a ? <p className="mt-1 text-slate-800">{a.summary}{a.missedOpportunity ? <span className="text-amber-800"> Missed: {a.missedOpportunity}</span> : null}</p> : null}
                {a?.notableQuote ? <p className="mt-1 text-xs italic text-slate-500">“{a.notableQuote}”</p> : null}
                {staff && (c.transcript || c.conversationId) ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-500">Transcript and recording</summary>
                    {c.conversationId ? <audio controls preload="none" className="mt-2 w-full" src={`/api/audits/calls/${c.id}/audio`} /> : null}
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{c.transcript || "No transcript yet."}</pre>
                    {a?.questions.length ? (
                      <ul className="mt-2 space-y-1 text-xs">{a.questions.map((q) => <li key={q.question}><b>{q.question}</b> → {q.answer || "(not answered)"} <span className="text-slate-400">[{q.answered}]</span></li>)}</ul>
                    ) : null}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
