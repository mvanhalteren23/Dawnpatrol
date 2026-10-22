import "server-only";
import { db } from "./db";
import { buildReceptionistPrompt, compileByCategory } from "./rag";
import { safeJson } from "./utils";

// ElevenLabs Conversational AI.
// Sync = compile KnowledgeItems per category -> upload as text KB documents -> create/patch
// the agent with the system prompt, first message, voice and KB doc references -> delete the
// previous generation of KB docs.

const BASE = "https://api.elevenlabs.io/v1/convai";

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

async function el<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} on ${path}: ${(await res.text()).slice(0, 500)}`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type KbDocRef = { category: string; docId: string; name: string };

export function agentConfig(
  r: Parameters<typeof buildReceptionistPrompt>[0] & { voiceId?: string | null; language: string; greeting: string },
  docs: KbDocRef[],
) {
  const greeting = r.greeting || `Thanks for calling ${r.businessName}, this is ${r.name}. How can I help you today?`;
  return {
    name: `${r.businessName} — ${r.name}`,
    conversation_config: {
      agent: {
        first_message: greeting,
        language: r.language,
        prompt: {
          prompt: buildReceptionistPrompt(r),
          ...(process.env.ELEVENLABS_LLM ? { llm: process.env.ELEVENLABS_LLM } : {}),
          knowledge_base: docs.map((d) => ({ type: "text", id: d.docId, name: d.name, usage_mode: "auto" })),
        },
      },
      ...((r.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID)
        ? { tts: { voice_id: r.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID } }
        : {}),
    },
  };
}

export async function syncReceptionist(receptionistId: string): Promise<{ agentId: string; docs: number }> {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, include: { knowledge: true } });
  const previous = safeJson<KbDocRef[]>(r.elevenLabsKbDocs, []);
  try {
    const compiled = compileByCategory(r.knowledge, r.businessName);
    const docs: KbDocRef[] = [];
    for (const d of compiled) {
      const created = await el<{ id: string }>("/knowledge-base/text", {
        method: "POST",
        body: JSON.stringify({ text: d.text, name: d.name }),
      });
      docs.push({ category: d.category, docId: created.id, name: d.name });
    }

    const config = agentConfig(r, docs);
    let agentId = r.elevenLabsAgentId;
    if (agentId) {
      await el(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(config) });
    } else {
      const created = await el<{ agent_id: string }>("/agents/create", { method: "POST", body: JSON.stringify(config) });
      agentId = created.agent_id;
    }

    await db.receptionist.update({
      where: { id: r.id },
      data: { elevenLabsAgentId: agentId, elevenLabsKbDocs: JSON.stringify(docs), syncStatus: "SYNCED", syncError: null, lastSyncedAt: new Date() },
    });

    // Old docs are detached now; remove them (best effort).
    for (const old of previous) {
      await el(`/knowledge-base/${old.docId}`, { method: "DELETE" }).catch((e) => console.warn("KB cleanup failed", e));
    }
    return { agentId, docs: docs.length };
  } catch (err) {
    await db.receptionist.update({ where: { id: r.id }, data: { syncStatus: "FAILED", syncError: (err as Error).message.slice(0, 1000) } });
    throw err;
  }
}

export async function markDirty(receptionistId: string) {
  await db.receptionist.updateMany({ where: { id: receptionistId, syncStatus: { not: "NEVER" } }, data: { syncStatus: "DIRTY" } });
}
