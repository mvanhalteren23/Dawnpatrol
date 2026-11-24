import "server-only";
import { createHash } from "node:crypto";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { textToSpeech } from "./elevenlabs";
import { audioUrl } from "./voicemail";
import { escapeXml, say } from "./twilio";
import { MESSAGES } from "./call-guard-rules";
import { LINE_CACHE_MS, TtlCache } from "./answer-path-rules";
import { safeJson } from "./utils";

// The fixed things a line says without the agent (the voicemail prompt, "all our lines are busy"),
// recorded once in the receptionist's own voice when it's synced, then played by Twilio from our
// server. The caller hears the same voice as the agent, it costs no agent minutes, and it still
// works when ElevenLabs is down or out of credits (it's already recorded). Anything not recorded
// yet falls back to Twilio reading it.

type Line = Pick<Receptionist, "id" | "accountId" | "businessName" | "voiceId" | "lifecycle" | "agentType">;

/** Every fixed message a line can say, for its business name. */
export function linePromptTexts(businessName: string): string[] {
  return [MESSAGES.voicemail(businessName), MESSAGES.busy(businessName, true), MESSAGES.busy(businessName, false)];
}

function promptName(receptionistId: string, text: string): string {
  return `line:${receptionistId}:${createHash("sha256").update(text).digest("hex").slice(0, 24)}`;
}

const found = new TtlCache<string>(LINE_CACHE_MS * 10);

/** TwiML that says `text` for this line: the recording if there is one, else Twilio's voice. */
export async function speak(r: Pick<Receptionist, "id">, text: string): Promise<string> {
  const name = promptName(r.id, text);
  try {
    const id = await found.getOrLoad(name, async () => (await db.voicemailAudio.findFirst({ where: { kind: "line", name }, select: { id: true } }))?.id as string);
    if (id) return `<Play>${escapeXml(audioUrl(id))}</Play>`;
  } catch (err) {
    console.warn("line prompt lookup failed; Twilio will read it", err);
  }
  return say(text);
}

/** Only lines that take real calls get recordings (not demos, follow-up or internal agents). */
export function recordsPrompts(r: Pick<Receptionist, "lifecycle" | "agentType">): boolean {
  return r.lifecycle !== "demo" && r.lifecycle !== "expired" && (r.agentType ?? "inbound") === "inbound";
}

/**
 * Record this line's fixed messages (after a sync). Only new or changed ones are generated (a few
 * hundred characters of ElevenLabs credit per line); ones for an old business name are removed.
 */
export async function recordLinePrompts(r: Line): Promise<{ recorded: number; kept: number }> {
  const voice = r.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!voice || !recordsPrompts(r)) return { recorded: 0, kept: 0 };
  const texts = linePromptTexts(r.businessName);
  const wanted = new Map(texts.map((t) => [promptName(r.id, t), t]));
  const existing = await db.voicemailAudio.findMany({ where: { kind: "line", name: { startsWith: `line:${r.id}:` } }, select: { id: true, name: true, script: true } });
  let recorded = 0;
  let kept = 0;
  for (const row of existing) {
    const meta = safeJson<{ voiceId?: string }>(row.script, {});
    if (wanted.has(row.name) && meta.voiceId === voice) {
      wanted.delete(row.name);
      kept++;
    } else {
      await db.voicemailAudio.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  }
  for (const [name, text] of wanted) {
    const data = new Uint8Array(await textToSpeech(text, voice));
    await db.voicemailAudio.create({ data: { kind: "line", name, data, script: JSON.stringify({ text, voiceId: voice }), accountId: r.accountId } });
    recorded++;
  }
  found.clear();
  return { recorded, kept };
}
