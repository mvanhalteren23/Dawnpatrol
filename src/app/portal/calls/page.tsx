import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { CallList } from "@/components/CallList";
import { syncCallsThrottled } from "@/lib/call-sync";

export const dynamic = "force-dynamic";

export default async function PortalCalls({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  if (receptionist) await syncCallsThrottled(receptionist.id);
  const calls = receptionist ? await db.callLog.findMany({ where: { receptionistId: receptionist.id }, orderBy: { startedAt: "desc" }, take: 200 }) : [];
  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-6">Calls</h1>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {receptionist ? <CallList receptionistId={receptionist.id} calls={calls} returnTo={`/portal/calls${q}`} /> : <Empty>No receptionist yet.</Empty>}
    </PortalShell>
  );
}
