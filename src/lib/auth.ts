import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type SessionPayload } from "./session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/portal");
  return session;
}

/** Portal pages: a client sees only their own account. Admins may view any account via ?account=. */
export async function requirePortalAccount(adminAccountId?: string): Promise<{ session: SessionPayload; accountId: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN") {
    if (!adminAccountId) redirect("/crm");
    return { session, accountId: adminAccountId };
  }
  if (!session.accountId) redirect("/login?error=no-account");
  return { session, accountId: session.accountId };
}

export async function login(email: string, password: string): Promise<SessionPayload | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "CLIENT",
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
export async function apiSession(role?: "ADMIN"): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  if (role === "ADMIN" && session.role !== "ADMIN") return null;
  return session;
}
