import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio helpers: webhook signing and TwiML (pure; unit tested), plus outbound SMS.

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, fullUrl + each POST param name+value, sorted by name)).
 * `url` must be exactly the URL configured in Twilio, including any query string.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validateTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function say(text: string): string {
  return `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>`;
}

/** Ask for an extension; digits are posted to `action`. Falls through to `onEmpty` (a Redirect) on timeout. */
export function gatherExtension(prompt: string, action: string, onEmpty: string): string {
  return twiml(
    `<Gather input="dtmf" finishOnKey="#" timeout="6" action="${escapeXml(action)}" method="POST">${say(prompt)}</Gather>` +
      `<Redirect method="POST">${escapeXml(onEmpty)}</Redirect>`,
  );
}

/** Digits only, "#"/"*" stripped. */
/** Send an SMS through the Twilio REST API. From = TWILIO_SMS_FROM, else the demo number. */
export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM || process.env.TWILIO_DEMO_NUMBER;
  if (!sid || !token || !from) throw new Error("Twilio SMS is not configured");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: toE164(to), From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** North American numbers spoken as 10 or 11 digits -> +1XXXXXXXXXX; anything with a + is kept. */
export function toE164(phone: string): string {
  const digits = cleanDigits(phone);
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function cleanDigits(input: string | null | undefined): string {
  return (input ?? "").replace(/[^0-9]/g, "");
}

/** Lowest free extension at or above `start` (demo extensions are short and easy to say). */
export function nextFreeExtension(taken: (string | null)[], start = 101): string {
  const used = new Set(taken.filter(Boolean));
  let n = start;
  while (used.has(String(n))) n++;
  return String(n);
}

/** Compare phone numbers by their last 10 digits (handles +1 / formatting differences). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = cleanDigits(a).slice(-10);
  const db = cleanDigits(b).slice(-10);
  return da.length === 10 && da === db;
}
