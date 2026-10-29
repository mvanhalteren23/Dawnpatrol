import "server-only";
import { db } from "./db";
import { buildReceptionistPrompt, compileByCategory } from "./rag";
import { buildFollowupPrompt, followupOpening, type FollowupProfile } from "./followup-rules";

/** Fill in follow-up fields that older records or test objects may not have. */
export function fullFollowupProfile(r: Partial<FollowupProfile> & { name: string; businessName: string; persona: string; timezone: string; businessHours: string; extraInstructions: string }): FollowupProfile {
  return { followupGoal: "", followupQuestions: "", followupGuardrails: "", ...r };
}
import { safeJson } from "./utils";
import { appUrl } from "./app-url";

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
type ToolIds = Record<string, string>;

const str = (description: string) => ({ type: "string", description });

/** Webhook tools that let the agent read the calendar and book (see src/lib/agent-booking.ts). */
export function bookingTools(r: { id: string; ragToken: string; timezone: string; bookingMeetingType: string; bookingQuestions: string; followUpOn: string; followUpChannel: string }) {
  const confirmations = r.followUpOn === "bookings" || r.followUpOn === "both";
  const base = `${appUrl()}/api/agent-tools/${r.id}`;
  const headers = { Authorization: `Bearer ${r.ragToken}` };
  return {
    get_available_times: {
      type: "webhook",
      name: "get_available_times",
      description: `Look up real open appointment times on the calendar. Call it whenever the caller wants to book or asks what's available, before offering any time. Times are in ${r.timezone}. The response includes today's date.`,
      response_timeout_secs: 20,
      api_schema: {
        url: `${base}/availability`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: {
            preferred_date: str("Day the caller asked for, as YYYY-MM-DD. Leave empty if they have no preference."),
            time_of_day: { type: "string", description: "Caller's preferred time of day", enum: ["any", "morning", "afternoon", "evening"] },
          },
          required: [],
        },
      },
    },
    book_appointment: {
      type: "webhook",
      name: "book_appointment",
      description: "Book the time the caller chose. Only call it after the caller has agreed to a time from get_available_times and you have their name and phone number.",
      response_timeout_secs: 30,
      api_schema: {
        url: `${base}/book`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: {
            start_iso: str("The start_iso of the chosen slot, copied exactly from get_available_times."),
            ...(r.bookingMeetingType === "caller_choice"
              ? { meeting_type: { type: "string", description: "How the caller wants to meet: a phone call or a Google Meet video call", enum: ["phone", "google_meet"] } }
              : {}),
            caller_name: str("Caller's full name."),
            caller_phone: str("Best callback number, confirmed back to the caller."),
            caller_email: str("Caller's email for the calendar invite, spelled back to confirm. Required for a Google Meet."),
            business_name: str("Caller's business name, if they have one."),
            business_type: str("Type of business or service, if mentioned."),
            interest: str("What they want to talk about or the service they're interested in."),
            ...(r.bookingQuestions.trim()
              ? { answers: str("The caller's answers to the pre-booking questions, one 'Question: answer' line each.") }
              : {}),
            ...(confirmations
              ? {
                  summary_method: {
                    type: "string",
                    enum: ["text", "email", "none"],
                    description: r.followUpChannel === "caller_choice"
                      ? "How the caller wants their booking confirmation: text, email, or none."
                      : `Send "none" only if the caller doesn't want a confirmation; otherwise "${r.followUpChannel === "email" ? "email" : "text"}".`,
                  },
                }
              : {}),
            conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
            notes: str("Anything else the team should know before the call."),
          },
          required: ["start_iso", "caller_name", "caller_phone"],
        },
      },
    },
  };
}

/** Create or update the booking tools; returns the tool ids to attach to the agent. */
/** Post-call fields ElevenLabs extracts from each call; the CRM uses them for outcomes and caller follow-ups. */
export const DATA_COLLECTION = {
  caller_name: { type: "string", description: "The caller's name as they gave it, or empty if not given." },
  callback_number: { type: "string", description: "Best callback number the caller gave, or empty." },
  caller_email: { type: "string", description: "The caller's email address if they gave one (as spelled back), or empty." },
  summary_delivery: { type: "string", enum: ["text", "email", "none"], description: "How the caller asked to receive a summary or confirmation: text, email, or none if they declined or weren't asked." },
};

/** Follow-up agents also report how the lead went. */
export const FOLLOWUP_DATA_COLLECTION = {
  lead_outcome: {
    type: "string",
    enum: ["booked", "interested", "call_back", "not_interested", "do_not_call", "wrong_number"],
    description: "How the follow-up call ended: booked (an appointment or visit was booked), interested (wants it but nothing booked yet), call_back (asked to be called at another time), not_interested, do_not_call (asked not to be called again), wrong_number.",
  },
};

/** Add our data-collection fields without dropping any configured by hand in ElevenLabs. */
async function mergedDataCollection(agentId: string | null, followup = false) {
  const ours = followup ? { ...DATA_COLLECTION, ...FOLLOWUP_DATA_COLLECTION } : DATA_COLLECTION;
  if (!agentId) return ours;
  const current = await el<{ platform_settings?: { data_collection?: Record<string, unknown> } }>(`/agents/${agentId}`).catch(() => null);
  return { ...(current?.platform_settings?.data_collection ?? {}), ...ours };
}

async function syncBookingTools(r: Parameters<typeof bookingTools>[0] & { bookingEnabled: boolean; elevenLabsToolIds: string }): Promise<ToolIds> {
  const existing = safeJson<ToolIds>(r.elevenLabsToolIds, {});
  if (!r.bookingEnabled) return existing; // keep the tools around; they're just detached from the agent
  const ids: ToolIds = {};
  for (const [name, tool_config] of Object.entries(bookingTools(r))) {
    const id = existing[name];
    if (id) {
      try {
        await el(`/tools/${id}`, { method: "PATCH", body: JSON.stringify({ tool_config }) });
        ids[name] = id;
        continue;
      } catch (e) {
        if (!String(e).includes(" 404 ")) throw e; // deleted in ElevenLabs: recreate below
      }
    }
    ids[name] = (await el<{ id: string }>("/tools", { method: "POST", body: JSON.stringify({ tool_config }) })).id;
  }
  return ids;
}

export function agentConfig(
  r: Parameters<typeof buildReceptionistPrompt>[0] &
    Partial<FollowupProfile> & { voiceId?: string | null; language: string; greeting: string; agentType?: string },
  docs: KbDocRef[],
  toolIds: string[] = [],
) {
  const followup = r.agentType === "followup";
  const greeting = followup ? followupOpening(r) : r.greeting || `Thanks for calling ${r.businessName}, this is ${r.name}. How can I help you today?`;
  return {
    name: `${r.businessName} — ${r.name}${followup ? " (follow-up)" : ""}`,
    conversation_config: {
      agent: {
        first_message: greeting,
        language: r.language,
        // Follow-up calls start with these filled from the lead; defaults keep test calls working.
        ...(followup ? { dynamic_variables: { dynamic_variable_placeholders: { lead_first_name: "there", lead_name: "the person who contacted us", lead_request: "They asked to be contacted.", lead_id: "" } } } : {}),
        prompt: {
          prompt: followup ? buildFollowupPrompt(fullFollowupProfile(r)) : buildReceptionistPrompt(r),
          ...(process.env.ELEVENLABS_LLM ? { llm: process.env.ELEVENLABS_LLM } : {}),
          knowledge_base: docs.map((d) => ({ type: "text", id: d.docId, name: d.name, usage_mode: "auto" })),
          tool_ids: toolIds,
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

    const toolIds = await syncBookingTools(r);
    const config = {
      ...agentConfig(r, docs, r.bookingEnabled ? Object.values(toolIds) : []),
      platform_settings: { data_collection: await mergedDataCollection(r.elevenLabsAgentId, r.agentType === "followup") },
    };
    let agentId = r.elevenLabsAgentId;
    if (agentId) {
      await el(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(config) });
    } else {
      const created = await el<{ agent_id: string }>("/agents/create", { method: "POST", body: JSON.stringify(config) });
      agentId = created.agent_id;
    }

    await db.receptionist.update({
      where: { id: r.id },
      data: { elevenLabsAgentId: agentId, elevenLabsKbDocs: JSON.stringify(docs), elevenLabsToolIds: JSON.stringify(toolIds), syncStatus: "SYNCED", syncError: null, lastSyncedAt: new Date() },
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

/**
 * Hand an in-progress Twilio call to an ElevenLabs agent. ElevenLabs answers with TwiML that
 * streams the call to the agent; we return it to Twilio as-is.
 */
export async function registerTwilioCall(
  agentId: string,
  from: string,
  to: string,
  opts: { direction?: "inbound" | "outbound"; dynamicVariables?: Record<string, string> } = {},
): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  const res = await fetch(`${BASE}/twilio/register-call`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      from_number: from,
      to_number: to,
      direction: opts.direction ?? "inbound",
      // Follow-up calls: who we're calling and what they asked for ({{lead_name}} etc. in the prompt).
      ...(opts.dynamicVariables ? { conversation_initiation_client_data: { dynamic_variables: opts.dynamicVariables } } : {}),
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} on register-call: ${body.slice(0, 300)}`);
  if (body.trimStart().startsWith("<")) return body;
  // Some API versions wrap the TwiML in JSON.
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const xml = Object.values(parsed).find((v): v is string => typeof v === "string" && v.trimStart().startsWith("<"));
  if (!xml) throw new Error("ElevenLabs register-call returned no TwiML");
  return xml;
}

/** Create an agent (agentId null) or update it; returns its id. Used for the shared call-audit caller. */
export async function upsertAgent(agentId: string | null, config: Record<string, unknown>): Promise<string> {
  if (agentId) {
    await el(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(config) });
    return agentId;
  }
  return (await el<{ agent_id: string }>("/agents/create", { method: "POST", body: JSON.stringify(config) })).agent_id;
}

// ---------------------------------------------------------------------------
// Conversations (call history, transcripts, recordings)
// ---------------------------------------------------------------------------

export type ConversationSummary = { conversation_id: string; agent_id?: string; status?: string; start_time_unix_secs?: number };

/** Finished and in-progress conversations for one agent, newest first, started after `afterUnix`. */
export async function listConversations(agentId: string, afterUnix: number, max = 300): Promise<ConversationSummary[]> {
  const out: ConversationSummary[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ agent_id: agentId, page_size: "100", call_start_after_unix: String(afterUnix) });
    if (cursor) qs.set("cursor", cursor);
    const page = await el<{ conversations?: ConversationSummary[]; has_more?: boolean; next_cursor?: string | null }>(`/conversations?${qs}`);
    out.push(...(page.conversations ?? []));
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor && out.length < max);
  return out;
}

/** Full conversation: transcript, metadata and analysis (same shape as the post-call webhook's data). */
export async function getConversation<T = unknown>(conversationId: string): Promise<T> {
  return el<T>(`/conversations/${encodeURIComponent(conversationId)}`);
}

/** The call recording as a streaming Response (audio/mpeg), or null if ElevenLabs has none. */
export async function fetchConversationAudio(conversationId: string, range?: string | null): Promise<Response | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  const res = await fetch(`${BASE}/conversations/${encodeURIComponent(conversationId)}/audio`, {
    headers: { "xi-api-key": key, ...(range ? { Range: range } : {}) },
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} on audio: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** Text to speech (mp3) in an ElevenLabs voice, for AI voicemails. */
export async function textToSpeech(text: string, voiceId: string, modelId = process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2"): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  // Full-quality model and 44.1kHz/128kbps audio: the fast, low-bitrate settings sound robotic on a phone line.
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: 1.0 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs voice ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
