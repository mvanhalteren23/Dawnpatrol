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
    receptionist: account.receptionists[0] ?? null,
    adminAccountId: session.role !== "CLIENT" ? accountId : undefined,
    q: session.role !== "CLIENT" ? `?account=${accountId}` : "",
  };
}
