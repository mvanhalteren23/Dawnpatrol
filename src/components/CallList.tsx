import { formatDate } from "@/lib/utils";
import { markCallFollowedUp } from "@/app/kb-actions";
import { Empty, StatusBadge } from "./ui";

type Call = { id: string; callerName: string | null; callerNumber: string | null; startedAt: Date; durationSec: number; summary: string; transcript: string; outcome: string; followUpNeeded: boolean; followedUpAt: Date | null };

export function CallList({ receptionistId, calls, returnTo }: { receptionistId: string; calls: Call[]; returnTo: string }) {
  return (
    <div className="card">
      <h2 className="mb-3">Recent calls</h2>
      {calls.length ? (
        <ul className="divide-y divide-slate-100">
          {calls.map((c) => (
            <li key={c.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{c.callerName ?? c.callerNumber ?? "Unknown caller"} <span className="text-xs font-normal text-slate-400">{formatDate(c.startedAt, true)} · {Math.round(c.durationSec / 60 * 10) / 10} min</span></span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={c.outcome} />
                  {c.followUpNeeded && !c.followedUpAt ? (
                    <form action={markCallFollowedUp.bind(null, receptionistId, c.id, returnTo)}><button className="btn-secondary px-2 py-1 text-xs">Mark followed up</button></form>
                  ) : c.followedUpAt ? <span className="text-xs text-emerald-700">followed up</span> : null}
                </span>
              </div>
              {c.callerNumber && c.callerName ? <div className="text-xs text-slate-500">{c.callerNumber}</div> : null}
              <p className="mt-1 text-slate-700">{c.summary}</p>
              {c.transcript ? <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-500">Transcript</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{c.transcript}</pre></details> : null}
            </li>
          ))}
        </ul>
      ) : <Empty>No calls yet. Calls appear once the ElevenLabs post-call webhook is configured.</Empty>}
    </div>
  );
}
