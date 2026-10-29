import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { formatDate } from "@/lib/utils";
import { Badge, Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { SubmitButton } from "@/components/SubmitButton";
import { AvailabilityFields, FollowUpFields, LeadAlertFields, ReportFields, RingFields } from "@/components/ReceptionistOptions";
import { saveReceptionistOptions, sendReportNow } from "@/app/receptionist-actions";
import { KeepNumberCard } from "@/components/KeepNumberCard";

export const dynamic = "force-dynamic";

export default async function PortalSettings({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const sent = receptionist ? await db.followUpMessage.findMany({ where: { receptionistId: receptionist.id }, orderBy: { createdAt: "desc" }, take: 15 }) : [];
  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">Receptionist settings</h1>
      <p className="mb-6 text-sm text-slate-500">When your receptionist can book appointments, whether callers get a summary afterwards, and your call reports.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {!receptionist ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <form action={saveReceptionistOptions.bind(null, receptionist.id, `/portal/settings${q}`)} className="card grid grid-cols-2 gap-3 lg:col-span-3">
            <h2 className="col-span-2">Booking hours &amp; holidays</h2>
            {!receptionist.bookingEnabled ? <p className="col-span-2 text-xs text-slate-500">Live calendar booking isn&apos;t switched on for your receptionist yet; until it is, callers leave preferred times instead, and callers leave preferred times instead. These hours apply once it&apos;s on.</p> : null}
            <AvailabilityFields r={receptionist} />
            {receptionist.businessNumber ? (
              <>
                <h2 className="col-span-2 mt-2">Business line {receptionist.businessNumber}</h2>
                <RingFields r={receptionist} />
              </>
            ) : null}
            <h2 className="col-span-2 mt-2">Lead texts to you</h2>
            <LeadAlertFields r={receptionist} />
            <h2 className="col-span-2 mt-2">Caller summaries</h2>
            <FollowUpFields r={receptionist} />
            <h2 className="col-span-2 mt-2" id="reports">Reports</h2>
            <ReportFields r={receptionist} />
            <div className="col-span-2"><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
          </form>
          <div className="space-y-6 lg:col-span-2">
          <KeepNumberCard r={receptionist} returnTo={`/portal/settings${q}`} admin={session.role === "ADMIN"} />
          <form action={sendReportNow.bind(null, receptionist.id, `/portal/settings${q}`)} className="card space-y-2 text-sm">
            <h2>Send a report now</h2>
            <p className="text-xs text-slate-500">Emails the report to {receptionist.reportEmails || "your portal login"}. Save your settings first if you changed who it goes to.</p>
            <div className="flex gap-2">
              <select name="kind" className="input w-auto" aria-label="Which report"><option value="week">Last week</option><option value="month">Last month</option></select>
              <SubmitButton className="btn-secondary" pendingText="Sending…">Send</SubmitButton>
            </div>
          </form>
          <div className="card">
            <h2 className="mb-3">Recent summaries sent</h2>
            {sent.length ? (
              <ul className="space-y-3 text-sm">
                {sent.map((m) => (
                  <li key={m.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{formatDate(m.createdAt, true)}</span>
                      <Badge>{m.kind === "booking" ? "booking" : m.kind === "owner_alert" ? "lead alert to you" : "call"}</Badge>
                      <span>{m.channel === "sms" ? "text" : "email"} to {m.to}</span>
                      {m.status === "FAILED" ? <Badge className="bg-red-100 text-red-800">not sent</Badge> : m.status === "SKIPPED" ? <Badge>not sent: caller opted out</Badge> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-slate-700">{m.body}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Nothing sent yet.</p>}
          </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
