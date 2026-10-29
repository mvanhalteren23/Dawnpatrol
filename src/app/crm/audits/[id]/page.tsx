import { appUrl } from "@/lib/app-url";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { canAccessAudit } from "@/lib/access";
import { formatSlot } from "@/lib/booking";
import { formatPhone } from "@/lib/demo-line";
import { auditCostCents, cad, estimateAuditCost, scenariosFor } from "@/lib/audit-rules";
import { parseReport, processAuditsThrottled, realCalls } from "@/lib/call-audit";
import { Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AuditReportView } from "@/components/AuditReportView";
import { auditFactsToKnowledge, cancelAudit, finishAuditNow, regenerateReport, runAuditNow, saveAuditAssumptions, testAuditCall } from "../actions";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!(await canAccessAudit(session, id))) notFound();
  await processAuditsThrottled();
  const audit = await db.callAudit.findUnique({ where: { id }, include: { account: true, calls: { orderBy: { scheduledAt: "asc" } } } });
  if (!audit) notFound();
  const receptionists = await db.receptionist.findMany({ where: { accountId: audit.accountId }, select: { id: true, name: true, agentType: true } });
  const calls = realCalls(audit.calls);
  const tests = audit.calls.filter((c) => c.toNumber).reverse();
  const report = parseReport(audit);
  const app = appUrl();
  const next = calls.find((c) => c.status === "PLANNED");
  const answered = audit.calls.filter((c) => c.status === "ANSWERED");
  const actual = auditCostCents({
    answered: answered.length,
    answeredMinutes: answered.reduce((n, c) => n + (c.durationSec ?? 0), 0) / 60,
    unanswered: audit.calls.filter((c) => ["VOICEMAIL", "NO_ANSWER", "BUSY"].includes(c.status)).length,
  });
  const live = audit.calls.some((c) => c.status === "CALLING") || audit.status === "ANALYZING";
  const active = audit.status === "RUNNING" || audit.status === "ANALYZING";

  return (
    <div>
      <AutoRefresh active={live} />
      <PageHeader
        title={`Call audit — ${audit.businessName}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Link href={`/crm/accounts/${audit.accountId}`}>{audit.account.name}</Link><StatusBadge status={audit.status} /><span className="text-xs text-slate-500">{formatPhone(audit.targetNumber)} · {formatSlot(audit.startsAt, audit.timezone).split(" at ")[0]} for 7 days</span></span>}
        actions={<>
          {active ? <form action={runAuditNow.bind(null, audit.id)}><SubmitButton className="btn-secondary" pendingText="Checking…">Check now</SubmitButton></form> : null}
          {audit.status === "RUNNING" ? <form action={finishAuditNow.bind(null, audit.id)}><SubmitButton className="btn-secondary" pendingText="Finishing…">End early and write report</SubmitButton></form> : null}
          {audit.status === "DONE" ? <form action={regenerateReport.bind(null, audit.id)}><SubmitButton className="btn-secondary" pendingText="Writing…">Rewrite report</SubmitButton></form> : null}
          {audit.status === "RUNNING" ? <form action={cancelAudit.bind(null, audit.id)}><button className="btn-danger">Cancel</button></form> : null}
        </>}
      />
      <Flash params={sp} />
      {audit.error ? <Notice kind="error">{audit.error}</Notice> : null}
      {audit.status === "RUNNING" && next ? <Notice>Next call: <b>{formatSlot(next.scheduledAt, audit.timezone)}</b> ({next.window}). {calls.filter((c) => c.status === "PLANNED").length} of {calls.length} still to go.</Notice> : null}
      {audit.status === "ANALYZING" ? <Notice>All calls are done. Transcripts are being analysed and the report written.</Notice> : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="card space-y-3 text-sm">
          <h2>Test the caller first</h2>
          <p className="text-xs text-slate-500">Calls your phone with one of this audit&apos;s topics. Answer as the shop would, to hear how it sounds. Test calls aren&apos;t counted in the report.</p>
          <form action={testAuditCall.bind(null, audit.id)} className="space-y-2">
            <input name="phone" type="tel" placeholder="Your cell" className="input" required />
            <select name="scenario" className="input">{scenariosFor(audit.industry, audit.customScenarios).map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}</select>
            <SubmitButton className="btn-secondary" pendingText="Calling…">Call me</SubmitButton>
          </form>
          {tests.length ? (
            <ul className="space-y-2 border-t border-slate-100 pt-2 text-xs">
              {tests.slice(0, 3).map((t) => (
                <li key={t.id}>
                  <b>{formatSlot(t.calledAt ?? t.scheduledAt, audit.timezone)}</b> · {t.status.toLowerCase()}{t.note ? ` · ${t.note}` : ""}
                  {t.transcript ? <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{t.transcript}</pre> : null}
                  {t.conversationId ? <audio controls preload="none" className="mt-1 w-full" src={`/api/audits/calls/${t.id}/audio`} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="card space-y-2 text-sm">
          <h2>Share with the owner</h2>
          <p className="text-xs text-slate-500">A read-only page with the numbers, findings and call summaries (no recordings or transcripts). Anyone with the link can open it.</p>
          <code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/audit-report/{audit.shareToken}</code>
          <h2 className="pt-3">Cost</h2>
          <p>So far: <b>{cad(actual.total)}</b> <span className="text-xs text-slate-500">(calls {cad(actual.twilio)}, test caller {cad(actual.elevenLabs)}, analysis {cad(actual.claude)})</span></p>
          <p className="text-xs text-slate-500">Planned at about {cad(estimateAuditCost(calls.length).total)} for {calls.length} calls. Owner&apos;s agreement: {audit.ownerConsent}</p>
        </div>

        <div className="space-y-6">
          <form action={saveAuditAssumptions.bind(null, audit.id)} className="card grid grid-cols-2 gap-2 text-sm">
            <h2 className="col-span-2">Estimate assumptions</h2>
            <Field label="Calls a week"><input name="callsPerWeek" type="number" defaultValue={audit.callsPerWeek} className="input" /></Field>
            <Field label="Average job ($)"><input name="avgJobValue" defaultValue={audit.avgJobValueCents / 100} className="input" /></Field>
            <Field label="% after hours"><input name="afterHoursPct" type="number" defaultValue={Math.round(audit.afterHoursShare * 100)} className="input" /></Field>
            <Field label="% new customers"><input name="newCustomerPct" type="number" defaultValue={Math.round(audit.newCustomerShare * 100)} className="input" /></Field>
            <Field label="% who'd book"><input name="bookingPct" type="number" defaultValue={Math.round(audit.bookingRate * 100)} className="input" /></Field>
            <div className="col-span-2"><SubmitButton className="btn-secondary" pendingText="Saving…">Save</SubmitButton></div>
          </form>
          {report?.facts.length ? (
            <form action={auditFactsToKnowledge.bind(null, audit.id)} className="card space-y-2 text-sm">
              <h2>Knowledge for the receptionist</h2>
              <p className="text-xs text-slate-500">{report.facts.length} facts staff gave callers (prices, hours, services, policies). They&apos;re added as drafts for review.</p>
              {receptionists.length ? (
                <>
                  <select name="receptionistId" className="input">{receptionists.map((r) => <option key={r.id} value={r.id}>{r.name}{r.agentType === "followup" ? " (follow-up)" : ""}</option>)}</select>
                  <SubmitButton className="btn-secondary" pendingText="Adding…">Add as knowledge drafts</SubmitButton>
                </>
              ) : <p className="text-xs">Create a receptionist on the account first.</p>}
              <details><summary className="cursor-pointer text-xs text-slate-500">Show the facts</summary>
                <ul className="mt-2 space-y-1 text-xs">{report.facts.map((f, i) => <li key={i}><b>[{f.category}] {f.title}:</b> {f.content}</li>)}</ul>
              </details>
            </form>
          ) : null}
        </div>
      </div>

      <AuditReportView audit={audit} calls={audit.calls} staff />
    </div>
  );
}
