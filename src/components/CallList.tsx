import { formatDate } from "@/lib/utils";
import { markCallFollowedUp, refreshCalls } from "@/app/kb-actions";
import { Empty, StatusBadge } from "./ui";
import { SubmitButton } from "./SubmitButton";

type Call = { id: string; callerName: string | null; callerNumber: string | null; startedAt: Date; durationSec: number; summary: string; transcript: string; outcome: string; followUpNeeded: boolean; followedUpAt: Date | null };

function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** One line per turn, "Receptionist:" / "Caller:" prefixes rendered as chat-style rows. */
function Transcript({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="mt-2 max-h-96 space-y-1 overflow-y-auto rounded bg-slate-50 p-3 text-xs">
      {lines.map((line, i) => {
        const m = /^(Receptionist|Caller):\s?(.*)$/.exec(line);
        const who = m?.[1];
        return (
          <p key={i} className={who === "Caller" ? "text-slate-900" : "text-slate-600"}>
            {who ? <span className={`mr-1 font-semibold ${who === "Caller" ? "text-indigo-700" : "text-slate-500"}`}>{who}:</span> : null}
            {m ? m[2] : line}
          </p>
        );
      })}
    </div>
  );
}

export function CallList({ receptionistId, calls, returnTo }: { receptionistId: string; calls: Call[]; returnTo: string }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2>Recent calls</h2>
        <form action={refreshCalls.bind(null, receptionistId, returnTo)}>
          <SubmitButton className="btn-secondary px-2 py-1 text-xs" pendingText="Checking…">Refresh calls</SubmitButton>
        </form>
      </div>
      {calls.length ? (
        <ul className="divide-y divide-slate-100">
          {calls.map((c) => (
            <li key={c.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{c.callerName ?? c.callerNumber ?? "Unknown caller"} <span className="text-xs font-normal text-slate-400">{formatDate(c.startedAt, true)} · {duration(c.durationSec)}</span></span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={c.outcome} />
                  {c.followUpNeeded && !c.followedUpAt ? (
                    <form action={markCallFollowedUp.bind(null, receptionistId, c.id, returnTo)}><button className="btn-secondary px-2 py-1 text-xs">Mark followed up</button></form>
                  ) : c.followedUpAt ? <span className="text-xs text-emerald-700">followed up</span> : null}
                </span>
              </div>
              {c.callerNumber && c.callerName ? <div className="text-xs text-slate-500">{c.callerNumber}</div> : null}
              {c.summary ? <p className="mt-1 text-slate-700">{c.summary}</p> : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-indigo-700">Recording &amp; transcript</summary>
                <audio controls preload="none" className="mt-2 w-full" src={`/api/calls/${c.id}/audio`}>
                  <a href={`/api/calls/${c.id}/audio`}>Download recording</a>
                </audio>
                <div className="mt-1 text-xs"><a href={`/api/calls/${c.id}/audio`} download>Download recording (MP3)</a></div>
                {c.transcript ? <Transcript text={c.transcript} /> : <p className="mt-2 text-xs text-slate-500">No transcript for this call.</p>}
              </details>
            </li>
          ))}
        </ul>
      ) : <Empty>No calls yet. New calls appear here automatically within a minute of hanging up — or press Refresh calls.</Empty>}
    </div>
  );
}
