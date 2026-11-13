import { createHmac, timingSafeEqual } from "node:crypto";
import { PHOTO_LINK_DAYS } from "./photo-rules";

// Signed, expiring links to the photos of one text (sent to the owner by text). The token carries
// Twilio's message id and an expiry, so a link can't be edited to show anyone else's photos.

function key(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

const sign = (payload: string) => createHmac("sha256", key()).update(`photos|${payload}`).digest("base64url").slice(0, 24);

export function photoToken(messageSid: string, now = Date.now(), days = PHOTO_LINK_DAYS): string {
  const payload = `${messageSid}.${Math.floor(now / 1000) + days * 86400}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** The message id a token is good for, or null if it's invalid or expired. */
export function readPhotoToken(token: string, now = Date.now()): string | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [messageSid, exp] = payload.split(".");
  if (!messageSid || !/^MM[0-9a-f]{32}$/i.test(messageSid) || Number(exp) * 1000 < now) return null;
  return messageSid;
}
