import "server-only";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type SessionPayload } from "./session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * The signed-in user. The cookie says who they are; their role and whether they're still allowed
 * in come from the database, so an admin's changes (role, disabling) apply on the next page load.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const user = await db.user.findUnique({ where: { id: token.sub }, select: { email: true, role: true, accountId: true, disabled: true } });
  if (!user || user.disabled) return null;
  const role = user.role === "ADMIN" || user.role === "REP" ? user.role : "CLIENT";
  return { sub: token.sub, email: user.email, role, accountId: user.accountId };
});

/** CRM users: administrators and sales reps. */
export async function requireStaff(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN" && session.role !== "REP") redirect("/portal");
  return session;
}

/** Administrators only: users, settings, billing, receptionists, deleting data. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireStaff();
  if (session.role !== "ADMIN") redirect("/crm?error=" + encodeURIComponent("Only an administrator can do that"));
  return session;
}

/** Portal pages: a client sees only their own account. Admins may view any account via ?account=. */
export async function requirePortalAccount(adminAccountId?: string): Promise<{ session: SessionPayload; accountId: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN" || session.role === "REP") {
    if (!adminAccountId) redirect("/crm");
    return { session, accountId: adminAccountId };
  }
  if (!session.accountId) redirect("/login?error=no-account");
  return { session, accountId: session.accountId };
}

export async function login(email: string, password: string): Promise<SessionPayload | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.disabled) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    role: user.role === "ADMIN" || user.role === "REP" ? user.role : "CLIENT",
    accountId: user.accountId,
  };
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(payload), sessionCookieOptions);
  return payload;
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** For API routes: returns the session or null (caller responds 401/403). */
export async function apiSession(role?: "ADMIN" | "STAFF"): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  if (role === "ADMIN" && session.role !== "ADMIN") return null;
  if (role === "STAFF" && session.role !== "ADMIN" && session.role !== "REP") return null;
  return session;
}
