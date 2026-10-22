import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ElevenLabs post-call webhooks send `ElevenLabs-Signature: t=<unix>,v0=<hex hmac>` where the
 * HMAC-SHA256 is over `${t}.${rawBody}` with the webhook secret.
 */
export function verifyElevenLabsSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 30 * 60, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const v0 = parts.v0;
  if (!t || !v0) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v0);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Generic shared-secret check for the outreach webhook (header or ?secret=). */
export function verifySharedSecret(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
