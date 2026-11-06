import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { deleteReceptionist } from "../actions";

export const dynamic = "force-dynamic";

export default async function Receptionists({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const list = await db.receptionist.findMany({
    orderBy: { updatedAt: "desc" },
    include: { account: true, _count: { select: { knowledge: true, calls: true } } },
  });
  const since = new Date(Date.now() - 7 * 86400000);
  const weekly = await db.callLog.groupBy({ by: ["receptionistId"], where: { startedAt: { gte: since } }, _count: true });
  const weeklyBy = Object.fromEntries(weekly.map((w) => [w.receptionistId, w._count]));
  return (
    <div>
      <PageHeader title="Receptionists & RAG" subtitle="Each client's AI receptionist, its knowledge base and ElevenLabs sync state. Create one from an account page." />
      <Flash params={await searchParams} />
      {list.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Receptionist</th><th>Client</th><th>KB items</th><th>Calls (7d / all)</th><th>ElevenLabs</th><th>Last sync</th><th></th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/crm/receptionists/${r.id}`} className="font-medium">{r.name}</Link><div className="text-xs text-slate-500">{r.agentType === "inbound" ? (r.bookingAddsToCrm ? "company line" : r.lifecycle) : r.agentType}</div></td>
                <td><Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link></td>
                <td>{r._count.knowledge}</td>
                <td>{weeklyBy[r.id] ?? 0} / {r._count.calls}</td>
                <td><StatusBadge status={r.syncStatus} /></td>
                <td className="text-xs">{formatDate(r.lastSyncedAt, true)}</td>
                <td className="text-right">
                  {r.bookingAddsToCrm && r.agentType === "inbound" ? <span className="text-xs text-slate-400">company line</span> : (
                    <details className="inline-block text-left">
                      <summary className="cursor-pointer text-xs font-semibold text-[#A8401F]">Delete</summary>
                      <form action={deleteReceptionist.bind(null, r.id)} className="mt-2 w-64 space-y-2 rounded-[10px] border border-slate-200 bg-white p-3 shadow-sm">
                        <p className="text-xs text-slate-600">Deletes {r.name} for good: from ElevenLabs, and its knowledge ({r._count.knowledge}), call logs ({r._count.calls}), leads and bookings.{r.businessNumber ? ` Remove its business line (${r.businessNumber}) on its page first.` : ""}</p>
                        <input name="confirm" placeholder={`Type ${r.name} to confirm`} className="input py-1 text-xs" autoComplete="off" required aria-label="Type the agent's name to confirm" />
                        <button className="btn-danger w-full py-1 text-xs" disabled={Boolean(r.businessNumber)}>Delete permanently</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>No receptionists yet.</Empty>}
    </div>
  );
}
