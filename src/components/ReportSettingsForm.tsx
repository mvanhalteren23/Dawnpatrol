import type { Receptionist } from "@prisma/client";
import { ReportFields } from "@/components/ReceptionistOptions";
import { SubmitButton } from "@/components/SubmitButton";
import { saveReportSettings, sendReportNow } from "@/app/receptionist-actions";

/** How often call reports are emailed and to whom, with a "send last week's now" button. */
export function ReportSettingsForm({ r, returnTo, fallbackEmail }: { r: Pick<Receptionist, "id" | "reportFrequency" | "reportEmails">; returnTo: string; fallbackEmail: string }) {
  return (
    <div className="card space-y-3">
      <div>
        <h2>Email reports</h2>
        <p className="text-xs text-slate-500">
          {r.reportFrequency
            ? `Sent ${r.reportFrequency === "both" ? "weekly and monthly" : r.reportFrequency} to ${r.reportEmails || fallbackEmail}.`
            : "Off. Choose how often you'd like a summary in your inbox."}
        </p>
      </div>
      <form action={saveReportSettings.bind(null, r.id, returnTo)} className="grid grid-cols-2 gap-3">
        <ReportFields r={r} />
        <div className="col-span-2"><SubmitButton pendingText="Saving…">Save report settings</SubmitButton></div>
      </form>
      <form action={sendReportNow.bind(null, r.id, returnTo)} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
        <span className="text-xs text-slate-500">Send one now:</span>
        <select name="kind" className="input w-auto py-1 text-sm" aria-label="Which report"><option value="week">Last week</option><option value="month">Last month</option></select>
        <SubmitButton className="btn-secondary py-1" pendingText="Sending…">Send</SubmitButton>
      </form>
    </div>
  );
}
