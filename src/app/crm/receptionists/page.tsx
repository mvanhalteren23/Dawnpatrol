import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Receptionists() {
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
      {list.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Receptionist</th><th>Client</th><th>KB items</th><th>Calls (7d / all)</th><th>ElevenLabs</th><th>Last sync</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/crm/receptionists/${r.id}`} className="font-medium">{r.name}</Link></td>
                <td><Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link></td>
                <td>{r._count.knowledge}</td>
                <td>{weeklyBy[r.id] ?? 0} / {r._count.calls}</td>
                <td><StatusBadge status={r.syncStatus} /></td>
                <td className="text-xs">{formatDate(r.lastSyncedAt, true)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>No receptionists yet.</Empty>}
    </div>
  );
}
