import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import type { SessionPayload } from "./session";

// Personal API keys. Only the SHA-256 hash is stored; the key itself is shown once.

const PREFIX = "had_";
export const MAX_TOKENS_PER_USER = 10;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createApiToken(userId: string, name: string, scopes = "prospects"): Promise<string> {
  const count = await db.apiToken.count({ where: { userId, revokedAt: null } });
  if (count >= MAX_TOKENS_PER_USER) throw new Error(`You already have ${MAX_TOKENS_PER_USER} keys. Revoke one you no longer use first.`);
  const token = PREFIX + randomBytes(30).toString("base64url");
  await db.apiToken.create({ data: { userId, name: name.trim().slice(0, 60) || "Claude skill", prefix: token.slice(0, 10), hash: hashToken(token), scopes } });
  return token;
}

/** The CRM user a request's `Authorization: Bearer had_…` key belongs to, if it's valid for `scope`. */
export async function sessionFromApiToken(req: Request, scope: string): Promise<SessionPayload | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!bearer.startsWith(PREFIX) || bearer.length < 30) return null;
  const t = await db.apiToken.findUnique({ where: { hash: hashToken(bearer) }, include: { user: true } });
  if (!t || t.revokedAt || !t.scopes.split(",").includes(scope)) return null;
  const u = t.user;
  if (u.disabled || (u.role !== "ADMIN" && u.role !== "REP")) return null;
  // Light write: at most once a minute.
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await db.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
  return { sub: u.id, email: u.email, role: u.role, accountId: null };
}
