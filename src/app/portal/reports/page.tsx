import Link from "next/link";
import { loadPortal } from "@/lib/portal";
import { buildReport } from "@/lib/client-reports";
import { delta, type ReportTotals } from "@/lib/report-rules";
import { syncCallsThrottled } from "@/lib/call-sync";
import { formatMoney } from "@/lib/utils";
import { Empty } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { ReportSettingsForm } from "@/components/ReportSettingsForm";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

const OUTCOMES: { key: keyof ReportTotals; label: string; tone: string }[] = [
  { key: "booked", label: "Appointments booked", tone: "bg-emerald-500" },
  { key: "messages", label: "Messages taken", tone: "bg-sky-500" },
  { key: "transfers", label: "Transferred to you", tone: "bg-indigo-500" },
  { key: "answered", label: "Questions answered", tone: "bg-slate-400" },
  { key: "missed", label: "Hung up / couldn't help", tone: "bg-amber-500" },
];

export default async function PortalReports({ searchParams }: { searchParams: Promise<{ account?: string; kind?: string; offset?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const kind = sp.kind === "month" ? "month" : "week";
  const offset = Math.min(0, Math.max(-24, Math.trunc(Number(sp.offset ?? 0)) || 0));
  const link = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(adminAccountId ? { account: adminAccountId } : {}), kind, offset: String(offset), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    return `/portal/reports?${p.toString()}`;
  };

  if (!receptionist) {
    return (
      <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
        <h1 className="mb-6">Reports</h1>
        <Empty>Reports start once your receptionist is answering calls.</Empty>
      </PortalShell>
    );
  }
  await syncCallsThrottled(receptionist.id);
  const { period, cur, prev, avgJobValueCents } = await buildReport(receptionist, kind, offset);
  const word = kind === "week" ? "week" : "month";
  const maxDay = Math.max(1, ...cur.perDay.map((d) => d.calls));
  const captured = cur.booked + cur.messages + cur.transfers;

  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Reports</h1>
          <p className="text-sm text-slate-500">{offset === 0 ? `This ${word} so far` : kind === "week" ? "Week of" : ""} {period.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            {(["week", "month"] as const).map((k) => (
              <Link key={k} href={link({ kind: k, offset: 0 })} className={`rounded-md px-3 py-1 hover:no-underline ${kind === k ? "bg-dawn-600 text-white" : "text-slate-600"}`}>{k === "week" ? "Weekly" : "Monthly"}</Link>
            ))}
          </div>
          <Link href={link({ offset: offset - 1 })} className="btn-secondary py-1">← Previous</Link>
          {offset < 0 ? <Link href={link({ offset: offset + 1 })} className="btn-secondary py-1">Next →</Link> : null}
        </div>
      </div>

      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Calls answered" value={cur.calls} sub={`${delta(cur.calls, prev.calls)} vs last ${word}`} />
        <Tile label="After hours" value={cur.afterHours ?? "—"} sub={cur.afterHours != null ? "would have gone to voicemail" : "set your hours in Settings"} />
        <Tile label="Appointments booked" value={cur.booked} sub={`${delta(cur.booked, prev.booked)} vs last ${word}`} />
        <Tile
          label="Est. value of bookings"
          value={cur.estValueCents != null ? formatMoney(cur.estValueCents) : "—"}
          sub={avgJobValueCents ? `${cur.booked} × ${formatMoney(avgJobValueCents)} average job` : "ask us to add your average job value"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <h2 className="mb-1">Calls by day</h2>
          <p className="mb-4 text-xs text-slate-500">{cur.busiestDay ? `Busiest: ${cur.busiestDay}s, ${cur.busiestHour}` : "No calls yet this period."}</p>
          <div className="flex h-40 items-end gap-1" role="img" aria-label={`Calls per day: ${cur.perDay.map((d) => `${d.date} ${d.calls}`).join(", ")}`}>
            {cur.perDay.map((d) => (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${d.calls} calls`}>
                <span className="text-[10px] tabular-nums text-slate-500">{d.calls || ""}</span>
                <div className="w-full rounded-t bg-dawn-600" style={{ height: `${(d.calls / maxDay) * 100}%`, minHeight: d.calls ? 4 : 1, opacity: d.calls ? 1 : 0.2 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[10px] text-slate-400">
            {cur.perDay.map((d, i) => (
              <span key={d.date} className="min-w-0 flex-1 text-center">{kind === "week" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] : i % 5 === 0 ? Number(d.date.slice(8)) : ""}</span>
            ))}
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="mb-1">What callers needed</h2>
          <p className="mb-4 text-xs text-slate-500">{captured} of {cur.calls} calls turned into a booking, a message or a transfer.</p>
          <ul className="space-y-2 text-sm">
            {OUTCOMES.map((o) => {
              const n = cur[o.key] as number;
              return (
                <li key={o.key}>
                  <div className="flex justify-between"><span>{o.label}</span><span className="tabular-nums">{n} <span className="text-xs text-slate-400">({delta(n, prev[o.key] as number)})</span></span></div>
                  <div className="mt-1 h-1.5 rounded bg-slate-100"><div className={`h-1.5 rounded ${o.tone}`} style={{ width: `${cur.calls ? (n / cur.calls) * 100 : 0}%` }} /></div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
            <span>Talk time: <b>{cur.minutes} min</b></span>
            <span>Average call: <b>{Math.floor(cur.avgDurationSec / 60)}:{String(cur.avgDurationSec % 60).padStart(2, "0")}</b></span>
            <span>Spam screened out: <b>{cur.spam}</b></span>
            <span>Still waiting on you: <b className={cur.waiting ? "text-red-700" : ""}>{cur.waiting}</b></span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div id="email-reports" className="lg:col-span-3">
          <ReportSettingsForm r={receptionist} returnTo={link({})} fallbackEmail={session.email} />
        </div>
        <div className="card text-sm text-slate-600 lg:col-span-2">
          <h2 className="mb-2">About these numbers</h2>
          <p>Counts come from every call your receptionist answered. &ldquo;After hours&rdquo; uses your bookable hours in Settings. Estimated value is bookings × your average job value.</p>
          <p className="mt-2">Emailed reports show totals only. Callers&apos; details stay here.</p>
          <Link href={`/portal/calls${q}`} className="mt-3 inline-block">See each call →</Link>
        </div>
      </div>
    </PortalShell>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
