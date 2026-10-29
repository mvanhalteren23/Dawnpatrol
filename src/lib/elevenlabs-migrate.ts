import "server-only";
import { db } from "./db";
import { el, legacyElevenLabsKey, syncReceptionist } from "./elevenlabs";
import { deleteSetting, getSetting, setSetting } from "./settings";

// Moving to a new ElevenLabs account (ELEVENLABS_API_KEY = new, ELEVENLABS_LEGACY_API_KEY = old).
// Agents can't be transferred between accounts, so each CRM agent is re-created in the new one:
// the voice, voice model, AI model, turn-taking and call-data fields are copied from the old agent,
// then the normal sync uploads the knowledge base, booking tools and instructions. Past calls stay
// in the CRM; their recordings keep playing through the old key.

const ROOT = "https://api.elevenlabs.io/v1";
export const MIGRATION_KEY = "elevenlabs.migration";

type VoiceCheck = { voiceId: string; ok: boolean; note: string };
export type MigrationReport = { at: string; agents: { name: string; from: string; to: string | null; note: string }[]; voices: VoiceCheck[] };

async function root<T>(path: string, key: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ROOT}${path}`, { ...init, headers: { "xi-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/**
 * Make a voice usable in the new account. Built-in voices already are; voices from the shared
 * Voice Library are added to it; voices cloned or designed in the old account can't be copied.
 */
export async function ensureVoice(voiceId: string, cache = new Map<string, VoiceCheck>()): Promise<VoiceCheck> {
  const hit = cache.get(voiceId);
  if (hit) return hit;
  const current = process.env.ELEVENLABS_API_KEY!;
  const legacy = legacyElevenLabsKey();
  const done = (ok: boolean, note: string) => {
    const r = { voiceId, ok, note };
    cache.set(voiceId, r);
    return r;
  };
  try {
    const v = await root<{ name?: string }>(`/voices/${voiceId}`, current);
    return done(true, `${v.name ?? voiceId} is available`);
  } catch {
    // not in the new account yet
  }
  if (!legacy) return done(false, "Not in the new account, and no old key to look it up");
  let old: { name?: string; category?: string; sharing?: { public_owner_id?: string } | null };
  try {
    old = await root(`/voices/${voiceId}`, legacy);
  } catch {
    return done(false, "Not found in either account");
  }
  const owner = old.sharing?.public_owner_id;
  if (owner) {
    try {
      await root(`/voices/add/${owner}/${voiceId}`, current, { method: "POST", body: JSON.stringify({ new_name: old.name ?? voiceId }) });
      return done(true, `${old.name ?? voiceId} added from the Voice Library`);
    } catch (err) {
      return done(false, `${old.name ?? voiceId}: couldn't add from the Voice Library (${(err as Error).message.slice(0, 120)})`);
    }
  }
  return done(false, `${old.name ?? voiceId} (${old.category ?? "custom"}) was made in the old account. Share it to the Voice Library from there, or re-create it in the new account, then set it on the agent`);
}

type OldAgent = {
  name?: string;
  conversation_config?: {
    tts?: Record<string, unknown> & { voice_id?: string };
    asr?: Record<string, unknown>;
    turn?: Record<string, unknown>;
    conversation?: Record<string, unknown>;
    agent?: { language?: string; first_message?: string; prompt?: { prompt?: string; llm?: string; temperature?: number } };
  };
  platform_settings?: { data_collection?: Record<string, { type?: string; description?: string; enum?: string[] }> };
};

function seedConfig(old: OldAgent, voiceOk: boolean, full: boolean) {
  const cc = old.conversation_config ?? {};
  const tts = { ...(full ? cc.tts : { model_id: cc.tts?.model_id }) };
  if (!voiceOk) delete tts.voice_id;
  else if (cc.tts?.voice_id) tts.voice_id = cc.tts.voice_id;
  const fields = Object.fromEntries(
    Object.entries(old.platform_settings?.data_collection ?? {}).map(([k, f]) => [k, { type: f.type ?? "string", description: f.description ?? "", ...(f.enum ? { enum: f.enum } : {}) }]),
  );
  return {
    name: old.name,
    conversation_config: {
      tts,
      ...(full ? { asr: cc.asr, turn: cc.turn, conversation: cc.conversation } : {}),
      agent: {
        language: cc.agent?.language ?? "en",
        first_message: cc.agent?.first_message ?? "",
        prompt: { prompt: cc.agent?.prompt?.prompt ?? "", ...(cc.agent?.prompt?.llm ? { llm: cc.agent.prompt.llm } : {}) },
      },
    },
    platform_settings: { data_collection: fields },
  };
}

/** Re-create every CRM agent that isn't in the new account yet. Safe to run again. */
export async function migrateAgents(): Promise<MigrationReport> {
  const legacy = legacyElevenLabsKey();
  if (!legacy) throw new Error("Set ELEVENLABS_LEGACY_API_KEY (the old account's key) first");
  if (legacy === process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is still the old account's key");
  const report: MigrationReport = { at: new Date().toISOString(), agents: [], voices: [] };
  const voices = new Map<string, VoiceCheck>();
  const receptionists = await db.receptionist.findMany({ where: { elevenLabsAgentId: { not: null } } });

  for (const r of receptionists) {
    const from = r.elevenLabsAgentId!;
    const entry = { name: `${r.businessName} — ${r.name}`, from, to: null as string | null, note: "" };
    report.agents.push(entry);
    try {
      const inNew = await el(`/agents/${from}`).then(() => true).catch(() => false);
      if (inNew) {
        entry.to = from;
        entry.note = "Already in the new account";
        continue;
      }
      const old = await el<OldAgent>(`/agents/${from}`, {}, legacy);
      const oldVoice = old.conversation_config?.tts?.voice_id ?? null;
      const voice = oldVoice ? await ensureVoice(oldVoice, voices) : null;
      let agentId: string;
      try {
        agentId = (await el<{ agent_id: string }>("/agents/create", { method: "POST", body: JSON.stringify(seedConfig(old, Boolean(voice?.ok), true)) })).agent_id;
      } catch {
        // Some copied settings may not be accepted as-is; keep the essentials.
        agentId = (await el<{ agent_id: string }>("/agents/create", { method: "POST", body: JSON.stringify(seedConfig(old, Boolean(voice?.ok), false)) })).agent_id;
      }
      await db.receptionist.update({
        where: { id: r.id },
        // The old account's knowledge documents and tools stay there; the sync makes new ones.
        data: { elevenLabsAgentId: agentId, elevenLabsKbDocs: "[]", elevenLabsToolIds: "{}", voiceId: r.voiceId ?? (voice?.ok ? oldVoice : null), syncStatus: "DIRTY" },
      });
      entry.to = agentId;
      await syncReceptionist(r.id);
      entry.note = voice && !voice.ok ? `Moved, but with the default voice: ${voice.note}` : "Moved and synced";
    } catch (err) {
      entry.note = `Not moved: ${(err as Error).message.slice(0, 300)}`;
    }
  }

  // Shared helpers that live in ElevenLabs: the call-audit caller is re-created on its next use.
  await deleteSetting("audit.agentId").catch(() => undefined);
  await deleteSetting("audit.agentVersion").catch(() => undefined);
  // Voices used outside agents: AI voicemails and the default voice.
  for (const id of [await getSetting("dialer.vm.voiceId"), process.env.ELEVENLABS_DEFAULT_VOICE_ID, process.env.ELEVENLABS_AUDIT_VOICE_ID]) {
    if (id) await ensureVoice(id, voices);
  }
  report.voices = [...voices.values()];
  await setSetting(MIGRATION_KEY, JSON.stringify(report));
  return report;
}
