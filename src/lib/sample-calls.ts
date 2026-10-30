import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { textToSpeech } from "./elevenlabs";
import { getSetting, setSetting } from "./settings";
import { FALLBACK_VOICES, INDUSTRIES, SAMPLE_VOICES, type Scenario, type TradeKey } from "./site-content";

// The website's sample calls, voiced by ElevenLabs: the receptionist in the trade's voice, the
// caller in another. Generated on first play and stored, so each costs credits once.

const DIALOGUE_MODEL = "eleven_v3";
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

type Turn = { text: string; voice_id: string };

function turns(trade: TradeKey, scenario: Scenario, fallback = false): Turn[] {
  const voices = SAMPLE_VOICES[trade];
  const caller = fallback ? FALLBACK_VOICES.caller : voices[scenario];
  const dispatcher = fallback ? FALLBACK_VOICES.dispatcher : voices.dispatcher;
  return INDUSTRIES[trade].simulation[scenario].transcript.map((l) => ({ text: l.text, voice_id: l.speaker === "AI Dispatcher" ? dispatcher : caller }));
}

export function sampleHash(trade: TradeKey, scenario: Scenario): string {
  return createHash("sha256").update(JSON.stringify({ t: turns(trade, scenario), m: DIALOGUE_MODEL })).digest("hex").slice(0, 32);
}

/** One natural-sounding conversation (ElevenLabs Text to Dialogue). */
async function dialogue(inputs: Turn[]): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ inputs, model_id: DIALOGUE_MODEL }),
  });
  if (!res.ok) throw new Error(`ElevenLabs dialogue ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Fallback: each line spoken separately and joined (MP3 frames play back to back). */
async function lineByLine(inputs: Turn[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const t of inputs) parts.push(await textToSpeech(t.text, t.voice_id));
  return Buffer.concat(parts);
}

async function generate(trade: TradeKey, scenario: Scenario): Promise<Buffer> {
  const attempts: (() => Promise<Buffer>)[] = [
    () => dialogue(turns(trade, scenario)),
    () => lineByLine(turns(trade, scenario)),
    () => lineByLine(turns(trade, scenario, true)), // a voice isn't in this account
  ];
  let last: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      console.warn("sample call generation", trade, scenario, err);
    }
  }
  throw last;
}

/** The stored recording, generating it first if the script or voices changed. Null while unavailable. */
export async function sampleAudio(trade: TradeKey, scenario: Scenario): Promise<{ data: Buffer; mime: string } | null> {
  const key = `${trade}:${scenario}`;
  const hash = sampleHash(trade, scenario);
  const stored = await db.sampleAudio.findUnique({ where: { key } });
  if (stored?.hash === hash) return { data: Buffer.from(stored.data), mime: stored.mime };
  // Don't let a failing key or a burst of visitors trigger repeated (paid) generations.
  const failKey = `samples.failedAt.${key}`;
  if (Date.now() - Number((await getSetting(failKey)) ?? 0) < RETRY_AFTER_FAILURE_MS) return stored ? { data: Buffer.from(stored.data), mime: stored.mime } : null;
  const lockKey = `samples.generating.${key}`;
  if (Date.now() - Number((await getSetting(lockKey)) ?? 0) < 90_000) return stored ? { data: Buffer.from(stored.data), mime: stored.mime } : null;
  await setSetting(lockKey, String(Date.now()));
  try {
    const data = await generate(trade, scenario);
    const bytes = new Uint8Array(data);
    await db.sampleAudio.upsert({ where: { key }, create: { key, hash, data: bytes, mime: "audio/mpeg" }, update: { hash, data: bytes, mime: "audio/mpeg", createdAt: new Date() } });
    return { data, mime: "audio/mpeg" };
  } catch {
    await setSetting(failKey, String(Date.now()));
    return stored ? { data: Buffer.from(stored.data), mime: stored.mime } : null;
  } finally {
    await setSetting(lockKey, "0");
  }
}
