// Edge-safe session helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "dp_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export type SessionPayload = {
  sub: string;
  email: string;
  role: "ADMIN" | "REP" | "CLIENT";
  accountId: string | null;
  iat?: number; // issued-at (seconds), set when read back from the cookie
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET must be set (16+ characters)");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    const role = payload.role === "ADMIN" || payload.role === "REP" ? payload.role : "CLIENT";
    const accountId = typeof payload.accountId === "string" ? payload.accountId : null;
    return { sub: payload.sub, email: payload.email, role, accountId, iat: typeof payload.iat === "number" ? payload.iat : 0 };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

// After a correct password, accounts with two-step sign-in get this short-lived pass instead of a
// session; the code (or a recovery code) on /login/verify turns it into a session.
export const MFA_COOKIE = "dp_mfa";
const MFA_SECONDS = 5 * 60;

export async function signMfaPending(userId: string, next: string): Promise<string> {
  return new SignJWT({ purpose: "mfa", next }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${MFA_SECONDS}s`).sign(secretKey());
}

export async function verifyMfaPending(token: string | undefined): Promise<{ userId: string; next: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.purpose !== "mfa" || typeof payload.sub !== "string") return null;
    return { userId: payload.sub, next: typeof payload.next === "string" ? payload.next : "" };
  } catch {
    return null;
  }
}

export const mfaCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: MFA_SECONDS };
