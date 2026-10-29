import type { Lead } from "@prisma/client";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/followup-rules";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui";

const TONE: Partial<Record<LeadStatus, string>> = {
  BOOKED: "bg-green-100 text-green-800",
  CONNECTED: "bg-sky-100 text-sky-800",
  CALL_BACK: "bg-amber-100 text-amber-800",
  NO_ANSWER: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  DO_NOT_CALL: "bg-red-100 text-red-800",
};

/** Website leads and what the follow-up agent did with each (CRM and client portal). */
export function LeadList({ leads, showNotes = false }: { leads: Lead[]; showNotes?: boolean }) {
  if (!leads.length) return <p className="text-sm text-slate-500">No website leads yet.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {leads.map((l) => (
        <li key={l.id} className="border-b border-slate-100 pb-3 last:border-0">
          <div className="flex flex-wrap items-center gap-2">
            <b>{l.name || "No name"}</b>
            <span className="text-slate-500">{l.phone ?? "no phone"}{l.email ? ` · ${l.email}` : ""}</span>
            <Badge className={TONE[l.status as LeadStatus]}>{LEAD_STATUSES[l.status as LeadStatus] ?? l.status}</Badge>
            {l.source === "test" ? <Badge>test</Badge> : null}
            <span className="ml-auto text-xs text-slate-400">{formatDate(l.createdAt, true)}</span>
          </div>
          {l.message ? <p className="mt-1 text-slate-600">“{l.message.slice(0, 300)}”</p> : null}
          {l.summary ? <p className="mt-1 text-slate-800"><span className="text-xs font-medium uppercase tracking-wide text-slate-500">Call: </span>{l.summary}</p> : null}
          {showNotes && l.statusNote ? <p className="mt-1 text-xs text-slate-500">{l.statusNote}{l.attempts ? ` · ${l.attempts} call attempt${l.attempts === 1 ? "" : "s"}` : ""}{l.nextAttemptAt && ["QUEUED", "RETRY"].includes(l.status) ? ` · next try ${formatDate(l.nextAttemptAt, true)}` : ""}</p> : null}
        </li>
      ))}
    </ul>
  );
}
