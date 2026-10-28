import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { getSetting } from "./settings";
import { companyName } from "./brand";
import { writeVoicemailScript } from "./ai";
import { textToSpeech } from "./elevenlabs";
import { accountVariables, renderPrompt } from "./prompts";
import { formatPhone } from "./demo-line";
import { dialerCallerId } from "./dialer";
import { twilioApi, voicemailDrop } from "./twilio";
import { appBase } from "./twilio-request";

// Voicemail drop for the auto-dialer. Audio lives in VoicemailAudio and is served to Twilio from
// /api/voicemail/<id>?t=<hmac> (an unguessable, signed URL, since Twilio can't log in).

export const VM_KEYS = {
  defaultId: "dialer.vm.defaultId", // recorded voicemail to drop
  prompt: "dialer.vm.prompt", // AI voicemail prompt template
  voiceId: "dialer.vm.voiceId", // ElevenLabs voice for AI voicemails
  callback: "dialer.vm.callback", // number to say in voicemails
  consent: "dialer.vm.consent", // "yes" once the compliance note is acknowledged
};

export const DEFAULT_VM_PROMPT = `Write a voicemail of 45-60 words (about 20 seconds spoken) left for {{contacts}} at {{company}}.
The speaker is Mike, {{my_company}}'s AI assistant, calling on behalf of Matt. Say that plainly; never pretend to be a person.
Mention one specific, true detail about their business from the research, the reason for calling (calls they miss are jobs they lose), and ask them to call or text Matt back at {{callback_number}}.
Say the callback number twice, in groups. Warm, plain, no hype, no pressure.`;

function sign(id: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set");
  return createHmac("sha256", secret).update(`vm:${id}`).digest("base64url").slice(0, 32);
}

export function verifyAudioToken(id: string, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(sign(id));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function audioUrl(id: string): string {
  return `${appBase()}/api/voicemail/${id}?t=${sign(id)}`;
}

export async function voicemailSettings() {
  const [defaultId, prompt, voiceId, callback, consent] = await Promise.all(Object.values(VM_KEYS).map((k) => getSetting(k)));
  return {
    defaultId,
    prompt: prompt || DEFAULT_VM_PROMPT,
    voiceId: voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID || null,
    callback: callback || (dialerCallerId() ? formatPhone(dialerCallerId()!) : ""),
    consent: consent === "yes",
  };
}

/** Save a Twilio recording (e.g. a voicemail you recorded by phone from the CRM). */
export async function saveTwilioRecording(recordingSid: string, name: string, durationSec: number) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${recordingSid}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
  });
  if (!res.ok) throw new Error(`Twilio recording ${res.status}`);
  const saved = await db.voicemailAudio.create({ data: { kind: "recorded", name, data: new Uint8Array(await res.arrayBuffer()), durationSec } });
  if (!(await getSetting(VM_KEYS.defaultId))) {
    const { setSetting } = await import("./settings");
    await setSetting(VM_KEYS.defaultId, saved.id);
  }
  return saved;
}

export type AiVoicemail = { id: string | null; script: string; voiceError?: string };

/** A pre-generated AI voicemail for the account (last 3 days), or null. Script-only ones have no audio. */
export async function cachedAiVoicemail(accountId: string): Promise<AiVoicemail | null> {
  const recent = await db.voicemailAudio.findFirst({ where: { accountId, kind: "ai", createdAt: { gte: new Date(Date.now() - 3 * 86400_000) } }, orderBy: { createdAt: "desc" }, select: { id: true, script: true, data: true } });
  if (!recent) return null;
  return { id: recent.data.length ? recent.id : null, script: recent.script ?? "" };
}

/**
 * The AI voicemail for an account: reuse one made in the last 3 days, else write a script from the
 * voicemail prompt + research and voice it with ElevenLabs. If the voice can't be generated the
 * script is kept (Twilio reads it) and the ElevenLabs error is returned so the dialer can show it.
 */
export async function aiVoicemail(accountId: string): Promise<AiVoicemail> {
  const cached = await cachedAiVoicemail(accountId);
  if (cached?.id) return cached;

  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { contacts: true, research: { where: { kind: "RESEARCH", status: "DONE" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const settings = await voicemailSettings();
  const script = cached?.script || (await writeVoicemailScript(
    renderPrompt(settings.prompt, { ...accountVariables(account), my_company: await companyName(), callback_number: settings.callback }),
    account.research[0]?.output ?? "",
  ));
  let data = new Uint8Array();
  let voiceError: string | undefined;
  if (!settings.voiceId) voiceError = "No ElevenLabs voice set";
  else {
    try {
      data = new Uint8Array(await textToSpeech(script, settings.voiceId));
    } catch (err) {
      voiceError = (err as Error).message;
      console.error("AI voicemail voice failed; Twilio will read the script", err);
    }
  }
  const saved = await db.voicemailAudio.create({ data: { kind: "ai", name: `AI voicemail: ${account.name}`, data, script, accountId } });
  return { id: data.length ? saved.id : null, script, voiceError };
}

/** Take over the prospect's leg (after the beep) to play the voicemail; the rep's browser is freed. */
export async function dropVoicemail(childCallSid: string, vm: { id: string | null; script?: string | null }) {
  const twiml = voicemailDrop({ audioUrl: vm.id ? audioUrl(vm.id) : null, script: vm.script });
  await twilioApi(`/Calls/${childCallSid}.json`, { form: { Twiml: twiml } });
}

export async function hangUpCall(callSid: string) {
  await twilioApi(`/Calls/${callSid}.json`, { form: { Status: "completed" } });
}
