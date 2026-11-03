import "server-only";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { MFA_COOKIE, mfaCookieOptions, SESSION_COOKIE, sessionCookieOptions, signMfaPending, signSession, verifyMfaPending, verifySession, type SessionPayload } from "./session";
import { hashRecoveryCode, verifyTotp } from "./totp";
import { open } from "./secret-box";
import { safeJson } from "./utils";

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
  const user = await db.user.findUnique({ where: { id: token.sub }, select: { email: true, role: true, accountId: true, disabled: true, sessionsValidAfter: true } });
  if (!user || user.disabled) return null;
  // Signed out everywhere after a password change/reset.
  if (user.sessionsValidAfter && (token.iat ?? 0) < Math.floor(user.sessionsValidAfter.getTime() / 1000)) return null;
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

/** Portal pages: a client sees only their own account. Admins may view any account via ?account=, reps their own clients. */
export async function requirePortalAccount(adminAccountId?: string): Promise<{ session: SessionPayload; accountId: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN" || session.role === "REP") {
    if (!adminAccountId) redirect("/crm");
    // Reps see the portal (callers' details, transcripts, billing) only for clients they own.
    if (session.role === "REP") {
      const account = await db.account.findUnique({ where: { id: adminAccountId }, select: { ownerId: true } });
      if (account?.ownerId !== session.sub) redirect(`/crm/accounts/${adminAccountId}?error=${encodeURIComponent("Only the account owner or an administrator can view this client's portal")}`);
    }
    return { session, accountId: adminAccountId };
  }
  if (!session.accountId) redirect("/login?error=no-account");
  return { session, accountId: session.accountId };
}

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
// Compared against when the email isn't found, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = "$2b$12$.GIOCwPl4zgnPKoykzlkP.pCeZAWM3HkCEPGg7WRRiJyBmocVMVsG";

export type LoginResult = { session: SessionPayload } | { mfa: true } | null;

/** Password check. With two-step sign-in on, it returns { mfa } and sets the short pass for /login/verify. */
export async function login(email: string, password: string, next = ""): Promise<LoginResult> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.disabled) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }
  // Too many wrong passwords: locked for a while (the same "invalid" answer, so it can't be probed).
  if (user.lockedUntil && user.lockedUntil > new Date()) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: failed >= MAX_FAILED_LOGINS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
    });
    return null;
  }
  if (user.totpEnabledAt && user.totpSecret) {
    const store = await cookies();
    store.set(MFA_COOKIE, await signMfaPending(user.id, next), mfaCookieOptions);
    return { mfa: true };
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  return { session: await issueSession(user) };
}

/** Second step: the authenticator code or a one-time recovery code. */
export async function completeMfaLogin(code: string): Promise<{ session: SessionPayload; next: string } | { error: string }> {
  const store = await cookies();
  const pending = await verifyMfaPending(store.get(MFA_COOKIE)?.value);
  if (!pending) return { error: "That took too long. Sign in again." };
  const user = await db.user.findUnique({ where: { id: pending.userId } });
  if (!user || user.disabled || !user.totpEnabledAt || !user.totpSecret) return { error: "Sign in again." };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { error: "Too many tries. Wait 15 minutes, then sign in again." };
  const clean = code.trim();
  let ok = false;
  const step = verifyTotp(open(user.totpSecret), clean, { lastUsedStep: user.totpLastStep });
  if (step != null) {
    ok = true;
    await db.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
  } else if (/[a-z]/i.test(clean)) {
    const codes = safeJson<string[]>(user.recoveryCodes, []);
    const hash = hashRecoveryCode(clean);
    if (codes.includes(hash)) {
      ok = true;
      await db.user.update({ where: { id: user.id }, data: { recoveryCodes: JSON.stringify(codes.filter((c) => c !== hash)) } });
    }
  }
  if (!ok) {
    const failed = user.failedLogins + 1;
    await db.user.update({ where: { id: user.id }, data: failed >= MAX_FAILED_LOGINS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed } });
    return { error: "That code didn't work. Check your authenticator app and try again." };
  }
  store.delete(MFA_COOKIE);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  return { session: await issueSession(user), next: pending.next };
}

/** Set the session cookie for this user (after sign-in, or after changing your own password). */
export async function issueSession(user: { id: string; email: string; role: string; accountId: string | null }): Promise<SessionPayload> {
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
