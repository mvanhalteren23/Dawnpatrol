import "server-only";
import { db } from "./db";
import { isClientStage } from "./constants";
import { canTouch } from "./team-rules";
import type { SessionPayload } from "./session";

/**
 * Who can work on a receptionist:
 * - admins: any;
 * - sales reps: demo receptionists on prospects they own (or unassigned ones). Once the account
 *   is a client, its receptionist is production and only admins manage it;
 * - clients: the receptionist on their own account (the portal).
 */
export async function canAccessReceptionist(session: SessionPayload | null, receptionistId: string): Promise<boolean> {
  if (!session) return false;
  if (session.role === "ADMIN") return true;
  const r = await db.receptionist.findUnique({ where: { id: receptionistId }, select: { accountId: true, account: { select: { ownerId: true, stage: true } } } });
  if (!r) return false;
  if (session.role === "REP") return canTouch(session, r.account.ownerId) && !isClientStage(r.account.stage);
  return Boolean(session.accountId && r.accountId === session.accountId);
}
