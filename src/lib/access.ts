import "server-only";
import { db } from "./db";
import type { SessionPayload } from "./session";

/** Admins can touch any receptionist; clients only those on their own account. */
export async function canAccessReceptionist(session: SessionPayload | null, receptionistId: string): Promise<boolean> {
  if (!session) return false;
  if (session.role === "ADMIN") return true;
  const r = await db.receptionist.findUnique({ where: { id: receptionistId }, select: { accountId: true } });
  return Boolean(r && session.accountId && r.accountId === session.accountId);
}
