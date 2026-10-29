import "server-only";
import { db } from "./db";
import { requirePortalAccount } from "./auth";

export async function loadPortal(searchParams: Promise<{ account?: string }>) {
  const sp = await searchParams;
  const { session, accountId } = await requirePortalAccount(sp.account);
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { receptionists: { orderBy: { createdAt: "asc" } } } });
  return {
    session,
    account,
    // The inbound receptionist drives calls, reports and setup; a follow-up agent has its own Leads page.
    receptionist: account.receptionists.find((r) => r.agentType !== "followup") ?? account.receptionists[0] ?? null,
    followupAgent: account.receptionists.find((r) => r.agentType === "followup") ?? null,
    adminAccountId: session.role !== "CLIENT" ? accountId : undefined,
    q: session.role !== "CLIENT" ? `?account=${accountId}` : "",
  };
}
