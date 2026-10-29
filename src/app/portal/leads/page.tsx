import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { processDueLeadsThrottled } from "@/lib/followup";
import { Empty, Stat } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { LeadList } from "@/components/LeadList";

export const dynamic = "force-dynamic";

export default async function PortalLeads({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const sp = await searchParams;
  const { session, account, followupAgent: f, adminAccountId } = await loadPortal(Promise.resolve(sp));
  if (f) await processDueLeadsThrottled().catch(() => undefined);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [leads, byStatus] = f
    ? await Promise.all([
        db.lead.findMany({ where: { receptionistId: f.id, source: { not: "test" } }, orderBy: { createdAt: "desc" }, take: 100 }),
        db.lead.groupBy({ by: ["status"], where: { receptionistId: f.id, source: { not: "test" }, createdAt: { gte: since } }, _count: true }),
      ])
    : [[], []];
  const n = (...s: string[]) => byStatus.filter((b) => s.includes(b.status)).reduce((t, b) => t + b._count, 0);
  const total = byStatus.reduce((t, b) => t + b._count, 0);

  return (
    <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">Website leads</h1>
      {!f ? <Empty>No follow-up agent on this account.</Empty> : (
        <>
          <p className="mb-6 text-sm text-slate-500">Everyone who filled in your website form, and what {f.name} did: it calls within minutes during your calling hours, finds out what they need and books the next step.</p>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Stat label="Leads (30 days)" value={total} />
            <Stat label="Talked to" value={n("CONNECTED", "BOOKED", "CALL_BACK", "NOT_INTERESTED")} />
            <Stat label="Booked" value={n("BOOKED")} />
            <Stat label="Couldn't reach" value={n("NO_ANSWER")} sub={f.followupTextIfMissed ? "sent a text" : undefined} />
          </div>
          <div className="card"><LeadList leads={leads} /></div>
        </>
      )}
    </PortalShell>
  );
}
