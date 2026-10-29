import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { formatDate } from "@/lib/utils";
import { hoursByDay, WEEK_ORDER } from "@/lib/booking";
import { companyName } from "@/lib/brand";
import { Badge, Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { KeepNumberCard } from "@/components/KeepNumberCard";
import { LeadAlertForm } from "@/components/LeadAlertForm";
import { ReportSettingsForm } from "@/components/ReportSettingsForm";
import { RequestChangeForm } from "@/components/RequestChangeForm";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FOLLOW_UP: Record<string, string> = { "": "Off", bookings: "After a booking", calls: "After every call", both: "After bookings and calls" };
const CHANNEL: Record<string, string> = { caller_choice: "by text or email, the caller chooses", sms: "by text", email: "by email" };
const MEETING: Record<string, string> = { phone: "phone call", google_meet: "Google Meet", caller_choice: "phone or Google Meet, the caller chooses" };
const RING: Record<string, string> = { always: "always", hours: "during your hours", never: "never" };

// Managed service: the team sets up and tunes the receptionist. Clients see how it's set up,
// choose their own notifications (lead texts, reports), and request any other change.
export default async function PortalSettings({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const [sent, company] = await Promise.all([
    receptionist ? db.followUpMessage.findMany({ where: { receptionistId: receptionist.id }, orderBy: { createdAt: "desc" }, take: 15 }) : [],
    companyName(),
  ]);
  const returnTo = `/portal/settings${q}`;
  const r = receptionist;
  const days = r ? hoursByDay(r.bookingHours) : {};

  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">Your setup</h1>
      <p className="mb-6 text-sm text-slate-500">How your receptionist is set up, and where we send your notifications. The {company} team manages the setup: request a change and we&apos;ll update and test it for you.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {!r ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <div className="card space-y-4 text-sm">
              <h2>How {r.name} is set up</h2>
              <Row label="Booking">
                {r.bookingEnabled
                  ? `Books ${r.bookingSlotMinutes}-minute "${r.bookingTitle}" appointments by ${MEETING[r.bookingMeetingType] ?? "phone"}, at least ${r.bookingMinNoticeHours} hours ahead, up to ${r.bookingDaysAhead} days out.`
                  : "Takes callers' preferred times; your team confirms the booking."}
              </Row>
              <Row label="Bookable hours">
                <ul className="space-y-0.5">
                  {WEEK_ORDER.map((d) => <li key={d}><span className="inline-block w-24 text-slate-500">{DAY_NAMES[d]}</span>{days[d] || "Closed"}</li>)}
                </ul>
              </Row>
              <Row label="Holidays and closures">
                {r.bookingHolidays ? "Statutory holidays observed" : "No holidays set"}
                {r.bookingClosedDates.trim() ? `; also closed ${r.bookingClosedDates.trim().split(/\s+/).join(", ")}` : ""}
              </Row>
              <Row label="Caller summaries">{FOLLOW_UP[r.followUpOn] ?? "Off"}{r.followUpOn ? `, ${CHANNEL[r.followUpChannel] ?? ""}` : ""}</Row>
              {r.businessNumber ? (
                <Row label="Business line">{r.businessNumber}: rings {r.ringFirstNumber ?? "nobody"} first ({RING[r.ringMode] ?? r.ringMode}, {r.ringSeconds} seconds), then {r.name} answers.</Row>
              ) : null}
              {r.escalationPhone ? <Row label="Urgent calls">Transferred to {r.escalationPhone}</Row> : null}
            </div>
            <RequestChangeForm receptionistId={r.id} returnTo={returnTo} defaultTopic="Hours, holidays or closures" />
            <KeepNumberCard r={r} returnTo={returnTo} admin={false} editable={false} />
          </div>

          <div className="space-y-6 lg:col-span-2">
            <LeadAlertForm r={r} returnTo={returnTo} />
            <div id="reports"><ReportSettingsForm r={r} returnTo={returnTo} fallbackEmail={session.email} /></div>
            <div className="card">
              <h2 className="mb-3">Recent texts and emails sent</h2>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}
