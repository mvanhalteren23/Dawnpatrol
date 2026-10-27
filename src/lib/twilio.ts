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

/**
 * Ring the owner's cell; the <Number url> plays a screening prompt to whoever picks up, so a
 * cell's own voicemail can't swallow the call. Unanswered/declined calls go to `action`.
 */
export function ringFirst(opts: { cell: string; seconds: number; callerId: string; screenUrl: string; action: string }): string {
  return twiml(
    `<Dial timeout="${Math.min(60, Math.max(5, opts.seconds))}" callerId="${escapeXml(opts.callerId)}" action="${escapeXml(opts.action)}" method="POST" answerOnBridge="true">` +
      `<Number url="${escapeXml(opts.screenUrl)}" method="POST">${escapeXml(opts.cell)}</Number></Dial>`,
  );
}

/** Played to the owner when they pick up: press 1 to take the call; otherwise the leg hangs up. */
export function screenPrompt(businessName: string, action: string): string {
  return twiml(
    `<Gather input="dtmf" numDigits="1" timeout="6" action="${escapeXml(action)}" method="POST">${say(`${businessName} call. Press 1 to answer, or hang up to send it to your receptionist.`)}</Gather><Hangup/>`,
  );
}

/** Forward an inbound text to the owner's cell. */
export function forwardSms(to: string, from: string, body: string): string {
  return twiml(`<Message to="${escapeXml(to)}">${escapeXml(`Text from ${from}: ${body}`)}</Message>`);
}

export async function twilioApi<T>(path: string, init: { method?: string; form?: Record<string, string> } = {}): Promise<T> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: init.method ?? (init.form ? "POST" : "GET"),
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init.form ? new URLSearchParams(init.form) : undefined,
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Send an SMS. From = the given number (e.g. a client's business line), else TWILIO_SMS_FROM, else the demo number. */
export async function sendSms(to: string, body: string, from?: string | null): Promise<void> {
  const sender = from || process.env.TWILIO_SMS_FROM || process.env.TWILIO_DEMO_NUMBER;
  if (!sender) throw new Error("Twilio SMS is not configured");
  await twilioApi("/Messages.json", { form: { To: toE164(to), From: sender, Body: body } });
}

export type TwilioNumber = { sid: string; phone_number: string; friendly_name: string };

/** First available local number in a country/area code (CA or US). */
export async function findLocalNumber(country: "CA" | "US", areaCode: string): Promise<string | null> {
  const res = await twilioApi<{ available_phone_numbers: { phone_number: string }[] }>(
    `/AvailablePhoneNumbers/${country}/Local.json?AreaCode=${encodeURIComponent(areaCode)}&VoiceEnabled=true&SmsEnabled=true&PageSize=1`,
  );
  return res.available_phone_numbers[0]?.phone_number ?? null;
}

/** Buy a number with its voice and SMS webhooks pointing at the CRM. */
export async function buyNumber(phoneNumber: string, label: string, voiceUrl: string, smsUrl: string): Promise<TwilioNumber> {
  return twilioApi<TwilioNumber>("/IncomingPhoneNumbers.json", {
    form: { PhoneNumber: phoneNumber, FriendlyName: label.slice(0, 64), VoiceUrl: voiceUrl, VoiceMethod: "POST", SmsUrl: smsUrl, SmsMethod: "POST" },
  });
}

/** Point a number already on the account at the CRM. */
export async function attachNumber(phoneNumber: string, label: string, voiceUrl: string, smsUrl: string): Promise<TwilioNumber> {
  const found = await twilioApi<{ incoming_phone_numbers: TwilioNumber[] }>(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`);
  const n = found.incoming_phone_numbers[0];
  if (!n) throw new Error(`${phoneNumber} isn't on this Twilio account`);
  return twilioApi<TwilioNumber>(`/IncomingPhoneNumbers/${n.sid}.json`, {
    form: { FriendlyName: label.slice(0, 64), VoiceUrl: voiceUrl, VoiceMethod: "POST", SmsUrl: smsUrl, SmsMethod: "POST" },
  });
}

/** Give a number back to Twilio (billing stops; the number may be reassigned). */
export async function releaseNumber(sid: string): Promise<void> {
  await twilioApi(`/IncomingPhoneNumbers/${sid}.json`, { method: "DELETE" });
}

/** Read the RingFields form (ringFirstNumber, ringSeconds, ringMode). Throws on a bad cell number. */
export function ringFromForm(form: FormData) {
  const cell = String(form.get("ringFirstNumber") ?? "").trim();
  if (cell && cleanDigits(cell).length < 10) throw new Error("Enter the cell number with area code, e.g. 604-555-1234");
  const mode = String(form.get("ringMode") ?? "");
  const seconds = Number(form.get("ringSeconds") ?? 20);
  return {
    ringFirstNumber: cell ? toE164(cell) : null,
    ringSeconds: Number.isFinite(seconds) ? Math.min(40, Math.max(10, Math.round(seconds))) : 20,
    ringMode: ["always", "hours", "never"].includes(mode) ? mode : "hours",
  };
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Twilio Access Token (JWT) with a Voice grant for outbound browser calls through a TwiML App. */
export function voiceAccessToken(o: { accountSid: string; apiKeySid: string; apiKeySecret: string; appSid: string; identity: string; ttlSec?: number; now?: number }): string {
  const iat = Math.floor((o.now ?? Date.now()) / 1000);
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${o.apiKeySid}-${iat}`,
    iss: o.apiKeySid,
    sub: o.accountSid,
    iat,
    exp: iat + (o.ttlSec ?? 3600),
    grants: { identity: o.identity, voice: { incoming: { allow: false }, outgoing: { application_sid: o.appSid } } },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${unsigned}.${createHmac("sha256", o.apiKeySecret).update(unsigned).digest("base64url")}`;
}

/**
 * Only North American numbers can be dialled from the CRM, and never premium-rate or
 * pay-per-call codes (toll-fraud guard). Returns E.164 or null.
 */
export function dialableNumber(input: string): string | null {
  const e164 = toE164(input);
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164)) return null;
  const area = e164.slice(2, 5);
  if (["900", "976"].includes(area) || e164.slice(5, 8) === "976") return null;
  return e164;
}

/**
 * Outbound dialer call: bridge the browser to `to`, recorded from answer, with status/recording
 * callbacks. With `amdCallback`, Twilio runs answering-machine detection on the dialled leg and
 * reports the result (after the greeting's beep) so a voicemail can be dropped.
 */
export function dialOut(o: { to: string; callerId: string; action: string; recordingCallback: string | null; amdCallback?: string | null }): string {
  const rec = o.recordingCallback
    ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(o.recordingCallback)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`
    : "";
  const amd = o.amdCallback
    ? ` machineDetection="DetectMessageEnd" machineDetectionTimeout="20" machineDetectionSpeechEndThreshold="900" machineDetectionSilenceTimeout="3000" amdStatusCallback="${escapeXml(o.amdCallback)}" amdStatusCallbackMethod="POST"`
    : "";
  return twiml(
    `<Dial callerId="${escapeXml(o.callerId)}" answerOnBridge="true" timeLimit="3600" action="${escapeXml(o.action)}" method="POST"${rec}><Number${amd}>${escapeXml(o.to)}</Number></Dial>`,
  );
}

/** TwiML for a voicemail drop: play the audio (or speak a script) after the beep, then hang up. */
export function voicemailDrop(o: { audioUrl?: string | null; script?: string | null }): string {
  if (o.audioUrl) return twiml(`<Play>${escapeXml(o.audioUrl)}</Play><Hangup/>`);
  return twiml(`<Say voice="Google.en-US-Chirp3-HD-Charon">${escapeXml(o.script ?? "")}</Say><Hangup/>`);
}

/** Is a Twilio AnsweredBy value a voicemail/machine whose greeting has finished? */
export function isMachineEnd(answeredBy: string | null | undefined): boolean {
  return /^machine_end_/.test(answeredBy ?? "");
}

/** Digits only, "#"/"*" stripped. */

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
