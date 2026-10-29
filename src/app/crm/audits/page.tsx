import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { processAuditsThrottled, realCalls } from "@/lib/call-audit";
import { formatDate } from "@/lib/utils";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

export default async function AuditsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireStaff();
  const sp = await searchParams;
  await processAuditsThrottled();
  const audits = await db.callAudit.findMany({
    where: session.role === "ADMIN" ? {} : { account: { OR: [{ ownerId: session.sub }, { ownerId: null }] } },
    include: { account: { select: { name: true } }, calls: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div>
      <PageHeader title="Call audits" subtitle="One week of test calls to a business's own number: how calls are handled, what callers are told, and how many are missed." actions={<Link href="/crm/audits/new" className="btn">New call audit</Link>} />
      <Flash params={sp} />
      {!audits.length ? <Empty>No audits yet. Start one from an account, or with “New call audit”.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2">Business</th><th>Status</th><th>Week of</th><th>Calls</th><th>Missed</th></tr></thead>
            <tbody>
              {audits.map((a) => {
                const calls = realCalls(a.calls);
                const placed = calls.filter((c) => ["ANSWERED", "VOICEMAIL", "NO_ANSWER", "BUSY"].includes(c.status));
                const missed = placed.filter((c) => c.status !== "ANSWERED").length;
                return (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="py-2"><Link href={`/crm/audits/${a.id}`}>{a.businessName}</Link> <span className="text-xs text-slate-400">{a.account.name}</span></td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>{formatDate(a.startsAt)}</td>
                    <td>{placed.length} / {calls.length}</td>
                    <td>{placed.length ? `${missed} (${Math.round((missed / placed.length) * 100)}%)` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
