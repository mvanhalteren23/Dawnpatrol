import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { recordActivity } from "./outreach";
import { summarizeCallRecording } from "./ai";
import { geminiConfigured } from "./ai/gemini";
import { toE164, twilioApi, voiceAccessToken } from "./twilio";
import { appBase } from "./twilio-request";

// Browser dialer: the CRM issues a Twilio Voice access token to admins; the browser connects
// through a TwiML App whose Voice URL is /api/voice/outbound, which bridges to the prospect.
// Each call is one CALL activity (externalId dialer:<parent CallSid>) that the status and
// recording callbacks and the outcome form all update.

const KEYS = { apiKeySid: "dialer.apiKeySid", apiKeySecret: "dialer.apiKeySecret", appSid: "dialer.appSid" };

export function dialerCallerId(): string | null {
  const raw = process.env.DIALER_CALLER_ID || process.env.TWILIO_DEMO_NUMBER;
  return raw ? toE164(raw) : null; // tolerate "+1 778-650-4870"-style values
}

/** Twilio's reason for a failed call (Monitor alerts for the call), e.g. "13227: No international permission". */
async function twilioFailureReason(callSids: string[]): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const res = await fetch(`https://monitor.twilio.com/v1/Alerts?StartDate=${encodeURIComponent(since)}&PageSize=50`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const { alerts = [] } = (await res.json()) as { alerts?: { error_code?: string; alert_text?: string; resource_sid?: string }[] };
  const hit = alerts.find((a) => a.resource_sid && callSids.includes(a.resource_sid));
  if (!hit) return null;
  const text = new URLSearchParams(hit.alert_text ?? "").get("Msg") ?? hit.alert_text ?? "";
  return `Twilio error ${hit.error_code}${text ? `: ${text}` : ""} (twilio.com/docs/api/errors/${hit.error_code})`;
}

export async function dialerStatus() {
  const [apiKeySid, apiKeySecret, appSid] = await Promise.all([getSetting(KEYS.apiKeySid), getSetting(KEYS.apiKeySecret), getSetting(KEYS.appSid)]);
  const twilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  return { ready: Boolean(twilio && apiKeySid && apiKeySecret && appSid && dialerCallerId()), twilio, apiKeySid, apiKeySecret, appSid, callerId: dialerCallerId(), notes: geminiConfigured() };
}

/** One-time setup: create the TwiML App and an API key on the Twilio account and store them. */
export async function setupDialer(): Promise<void> {
  const voiceUrl = `${appBase()}/api/voice/outbound`;
  if (!voiceUrl.startsWith("https://")) throw new Error("APP_URL must be the public https URL of the CRM");
  const status = await dialerStatus();
  if (!status.twilio) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured");
  if (status.appSid) {
    await twilioApi(`/Applications/${status.appSid}.json`, { form: { VoiceUrl: voiceUrl, VoiceMethod: "POST" } });
  } else {
    const app = await twilioApi<{ sid: string }>("/Applications.json", { form: { FriendlyName: "CRM dialer", VoiceUrl: voiceUrl, VoiceMethod: "POST" } });
    await setSetting(KEYS.appSid, app.sid);
  }
  if (!status.apiKeySid || !status.apiKeySecret) {
    const key = await twilioApi<{ sid: string; secret: string }>("/Keys.json", { form: { FriendlyName: "CRM dialer" } });
    await setSetting(KEYS.apiKeySid, key.sid);
    await setSetting(KEYS.apiKeySecret, key.secret);
  }
}

export async function dialerToken(identity: string): Promise<string> {
  const s = await dialerStatus();
  if (!s.ready) throw new Error("The dialer isn't set up yet (CRM → Settings → Dialer)");
  return voiceAccessToken({ accountSid: process.env.TWILIO_ACCOUNT_SID!, apiKeySid: s.apiKeySid!, apiKeySecret: s.apiKeySecret!, appSid: s.appSid!, identity, ttlSec: 3600 });
}

const externalId = (callSid: string) => `dialer:${callSid}`;

/** Find or create the CALL activity for a dialer call (safe against the callbacks racing each other). */
export async function ensureCallActivity(o: { callSid: string; accountId: string; contactId?: string | null; to?: string; userId?: string | null }) {
  const existing = await db.activity.findUnique({ where: { externalId: externalId(o.callSid) } });
  if (existing) return existing;
  try {
    const created = await recordActivity({
      accountId: o.accountId,
      contactId: o.contactId || null,
      type: "CALL",
      direction: "OUTBOUND",
      subject: "Call",
      body: o.to ? `Dialled ${o.to}` : null,
      source: "dialer",
      externalId: externalId(o.callSid),
      createdById: o.userId ?? null,
    });
    if (created) return created;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  return db.activity.findUniqueOrThrow({ where: { externalId: externalId(o.callSid) } });
}

export async function recordDialStatus(o: { callSid: string; accountId: string; contactId?: string | null; status: string; durationSec: number; dialCallSid?: string | null }) {
  const a = await ensureCallActivity(o);
  if (o.status === "failed") {
    // Alerts can lag the callback by a few seconds.
    await new Promise((r) => setTimeout(r, 4000));
    const reason = await twilioFailureReason([o.callSid, o.dialCallSid].filter((x): x is string => Boolean(x)));
    await db.activity.update({ where: { id: a.id }, data: { body: [a.body, reason ?? "Twilio couldn't place the call. Twilio Console → Monitor → Logs → Errors has the reason."].filter(Boolean).join("\n") } });
  }
  const unanswered = ["no-answer", "busy", "failed", "canceled"].includes(o.status);
  await db.activity.update({
    where: { id: a.id },
    data: {
      durationSec: o.durationSec || a.durationSec,
      ...(unanswered && !a.outcome ? { outcome: o.status === "busy" || o.status === "no-answer" ? "no_answer" : a.outcome, subject: `Call — ${o.status.replace("-", " ")}` } : {}),
    },
  });
}

/** Download a recording from Twilio (authenticated). */
export async function fetchRecording(recordingSid: string): Promise<Response> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio is not configured");
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${recordingSid}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
  });
}

/** Store the recording on the call and, with Gemini configured, add a transcript, summary and suggested next step. */
export async function attachRecording(o: { callSid: string; accountId: string; contactId?: string | null; recordingSid: string; durationSec: number }) {
  const a = await ensureCallActivity(o);
  await db.activity.update({ where: { id: a.id }, data: { recordingSid: o.recordingSid, durationSec: Math.max(a.durationSec ?? 0, o.durationSec) || null } });
  if (!geminiConfigured() || o.durationSec < 5) return;
  const res = await fetchRecording(o.recordingSid);
  if (!res.ok) throw new Error(`Twilio recording ${res.status}`);
  const account = await db.account.findUnique({ where: { id: o.accountId }, select: { name: true } });
  const notes = await summarizeCallRecording({ data: Buffer.from(await res.arrayBuffer()), mimeType: "audio/mpeg" }, `The business called is ${account?.name ?? "a prospect"}.`);
  const fresh = await db.activity.findUniqueOrThrow({ where: { id: a.id } });
  await db.activity.update({
    where: { id: a.id },
    data: {
      outcome: fresh.outcome ?? notes.outcome,
      body: [fresh.body, `Summary: ${notes.summary}`, `Suggested next step: ${notes.nextStep}`, `Transcript:\n${notes.transcript}`].filter(Boolean).join("\n\n"),
    },
  });
}
