import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { SessionPayload } from "./session";
import { accountKeyName, phoneKey } from "./team-rules";

// The sales team: one owner per account, reps work only their own (or unassigned) accounts,
// and nothing is added twice across the organization.

export { canTouch, isStaff, ROLES, ROLE_LABELS } from "./team-rules";

export class OwnershipError extends Error {}

/** Staff who can own accounts (admins and reps), for owner pickers. */
export function teamMembers() {
  return db.user.findMany({
    where: { role: { in: ["ADMIN", "REP"] }, disabled: false },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}

export function memberLabel(u: { name: string | null; email: string } | null | undefined): string {
  return u ? u.name || u.email : "Unassigned";
}

/**
 * Before a rep (or admin) works an account: refuse if another person owns it; if nobody does,
 * the account becomes theirs (first touch claims it). Admins can work any account.
 */
export async function touchAccount(session: Pick<SessionPayload, "sub" | "role">, accountId: string): Promise<void> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { ownerId: true, owner: { select: { name: true, email: true } } } });
  if (!account) throw new OwnershipError("Account not found");
  if (account.ownerId === session.sub) return;
  if (account.ownerId) {
    if (session.role === "ADMIN") return;
    throw new OwnershipError(`${memberLabel(account.owner)} owns this account. Ask an admin to reassign it to you.`);
  }
  // Unassigned: claim it (only if still unassigned, so two reps can't both claim it).
  const claimed = await db.account.updateMany({ where: { id: accountId, ownerId: null }, data: { ownerId: session.sub } });
  if (claimed.count) {
    await db.activity.create({ data: { accountId, type: "NOTE", source: "system", subject: "Account assigned", body: "Assigned on first touch.", createdById: session.sub } });
    return;
  }
  return touchAccount(session, accountId); // someone else claimed it a moment ago
}

export type DuplicateMatch = { id: string; name: string; owner: string; reason: string };

/** An existing account that is the same business: same website domain, phone number, or name (in the same city). */
export async function findDuplicateAccount(a: { domain?: string | null; phone?: string | null; name?: string | null; city?: string | null }, excludeId?: string): Promise<DuplicateMatch | null> {
  const not = excludeId ? Prisma.sql`AND a.id <> ${excludeId}` : Prisma.empty;
  const checks: { reason: string; where: Prisma.Sql }[] = [];
  if (a.domain) checks.push({ reason: "same website", where: Prisma.sql`a.domain = ${a.domain}` });
  const phone = phoneKey(a.phone);
  if (phone) checks.push({ reason: "same phone number", where: Prisma.sql`right(regexp_replace(coalesce(a.phone, ''), '\\D', '', 'g'), 10) = ${phone}` });
  const name = accountKeyName(a.name);
  if (name && name.length >= 4) {
    const city = (a.city ?? "").trim().toLowerCase();
    checks.push({
      reason: city ? "same name and city" : "same name",
      where: Prisma.sql`regexp_replace(lower(a.name), '[^a-z0-9]|\\m(inc|ltd|llc|corp|co|limited|the)\\M', '', 'g') = ${name}
        AND (${city} = '' OR a.city IS NULL OR lower(trim(a.city)) = ${city})`,
    });
  }
  for (const c of checks) {
    const rows = await db.$queryRaw<{ id: string; name: string; ownerName: string | null; ownerEmail: string | null }[]>(Prisma.sql`
      SELECT a.id, a.name, u.name AS "ownerName", u.email AS "ownerEmail"
      FROM "Account" a LEFT JOIN "User" u ON u.id = a."ownerId"
      WHERE ${c.where} ${not}
      LIMIT 1`);
    const r = rows[0];
    if (r) return { id: r.id, name: r.name, owner: r.ownerEmail ? r.ownerName || r.ownerEmail : "Unassigned", reason: c.reason };
  }
  return null;
}
