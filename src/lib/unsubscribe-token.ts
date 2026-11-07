import { createHmac, timingSafeEqual } from "node:crypto";

// Unsubscribe links: the address, signed, so a link can't be edited to unsubscribe someone else.

function key(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(email: string): string {
  return createHmac("sha256", key()).update(`unsubscribe|${email}`).digest("base64url").slice(0, 24);
}

export function unsubscribeToken(email: string): string {
  const e = email.trim().toLowerCase();
  return `${Buffer.from(e).toString("base64url")}.${sign(e)}`;
}

/** The address a token is for, or null when it's been tampered with. */
export function readUnsubscribeToken(token: string): string | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let email: string;
  try {
    email = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email.includes("@") || email.length > 254) return null;
  const a = Buffer.from(sign(email));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b) ? email : null;
}

export function unsubscribeUrl(base: string, email: string): string {
  return `${base.replace(/\/$/, "")}/unsubscribe/${unsubscribeToken(email)}`;
}

/** For RFC 8058 one-click: mail apps POST here. */
export function oneClickUrl(base: string, email: string): string {
  return `${base.replace(/\/$/, "")}/api/unsubscribe/${unsubscribeToken(email)}`;
}

/** "ma***@shop.com", for the unsubscribe page. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`;
}
