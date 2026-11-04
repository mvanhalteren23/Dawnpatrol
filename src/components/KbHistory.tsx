import { formatDate } from "@/lib/utils";
import { describeRevision } from "@/lib/kb-history-rules";
import { undoKbRevision } from "@/app/kb-actions";
import { Empty } from "./ui";

type Rev = { id: string; action: string; before: string | null; after: string | null; byEmail: string | null; byRole: string | null; undoOfId: string | null; undoneAt: Date | null; createdAt: Date };

/** Recent knowledge-base changes, each with Undo (shared by the CRM and the client portal). */
export function KbHistory({ receptionistId, revisions, returnTo, teamName }: { receptionistId: string; revisions: Rev[]; returnTo: string; teamName: string }) {
  return (
    <div className="card">
      <h2 className="mb-1">History</h2>
      <p className="mb-3 text-xs text-slate-500">Every change, newest first. Undo puts that item back the way it was before the change (and can itself be undone).</p>
      {revisions.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className={r.undoneAt ? "text-slate-400 line-through" : ""}>{describeRevision(r)}</div>
                <div className="text-xs text-slate-500">{formatDate(r.createdAt, true)} · {r.byRole === "CLIENT" ? r.byEmail ?? "you" : r.byRole === "system" ? "automatic" : `${teamName}${r.byEmail ? ` (${r.byEmail})` : ""}`}{r.undoneAt ? " · undone" : ""}</div>
              </div>
              {r.undoneAt ? null : (
                <form action={undoKbRevision.bind(null, receptionistId, r.id, returnTo)}>
                  <button className="btn-secondary whitespace-nowrap px-2 py-1 text-xs">Undo</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : <Empty>No changes yet.</Empty>}
    </div>
  );
}
