import Link from "next/link";
import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { formatDate } from "@/lib/utils";
import { Empty, Stat, StatusBadge } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";

export const dynamic = "force-dynamic";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(searchParams);
  const since = new Date(Date.now() - 30 * 86400000);
  const [calls, byOutcome, followUps, kbCount] = receptionist
    ? await Promise.all([
        db.callLog.count({ where: { receptionistId: receptionist.id, startedAt: { gte: since } } }),
        db.callLog.groupBy({ by: ["outcome"], where: { receptionistId: receptionist.id, startedAt: { gte: since } }, _count: true }),
        db.callLog.findMany({ where: { receptionistId: receptionist.id, followUpNeeded: true, followedUpAt: null }, orderBy: { startedAt: "desc" }, take: 10 }),
        db.knowledgeItem.count({ where: { receptionistId: receptionist.id, isActive: true } }),
      ])
    : [0, [], [], 0];
  const outcome = Object.fromEntries(byOutcome.map((o) => [o.outcome, o._count]));
  const captured = (outcome.BOOKED ?? 0) + (outcome.MESSAGE_TAKEN ?? 0) + (outcome.TRANSFERRED ?? 0);

  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-6">Welcome back</h1>
      {!receptionist ? <Empty>Your receptionist is being set up by the Dawn Patrol team. You&apos;ll see calls here as soon as it goes live.</Empty> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Calls answered (30d)" value={calls} sub="Every call picked up, 24/7" />
            <Stat label="Appointments booked" value={outcome.BOOKED ?? 0} />
            <Stat label="Leads captured" value={captured} sub="booked + messages + transfers" />
            <Stat label="Needs your follow-up" value={followUps.length} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-3">Callers waiting on you</h2>
              {followUps.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {followUps.map((c) => (
                    <li key={c.id} className="py-2">
                      <div className="flex justify-between"><span className="font-medium">{c.callerName ?? c.callerNumber ?? "Unknown"}</span><StatusBadge status={c.outcome} /></div>
                      <div className="text-xs text-slate-500">{c.callerNumber} · {formatDate(c.startedAt, true)}</div>
                      <div className="text-slate-700">{c.summary}</div>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No one waiting. Nice.</Empty>}
              <Link href={`/portal/calls${q}`} className="mt-3 inline-block text-sm">All calls →</Link>
            </div>
            <div className="card">
              <h2 className="mb-2">Your receptionist</h2>
              <div className="flex items-center gap-2 text-sm"><b>{receptionist.name}</b> <StatusBadge status={receptionist.elevenLabsAgentId ? "ACTIVE" : "SETTING_UP"} /></div>
              <p className="mt-2 text-sm text-slate-600">{kbCount} active knowledge items. Keep services, hours and pricing up to date — your receptionist only answers from this knowledge base.</p>
              <Link href={`/portal/knowledge${q}`} className="btn mt-4">Update knowledge base</Link>
            </div>
          </div>
        </>
      )}
    </PortalShell>
  );
}
