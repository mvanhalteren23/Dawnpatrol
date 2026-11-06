import { conversationLimits } from "./call-guard-rules";
import "server-only";
import { BUILDER_DYNAMIC_DEFAULTS, buildBuilderPrompt, builderOpening } from "./builder-rules";
import { buildCheckinPrompt, CHECKIN_DYNAMIC_DEFAULTS, checkinOpening } from "./customer-text-rules";
import { defaultGreeting } from "./safety-rules";
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

/** The previous ElevenLabs account's key, kept after moving accounts so old recordings still play. */
export function legacyElevenLabsKey(): string | null {
  return process.env.ELEVENLABS_LEGACY_API_KEY || null;
}

/** Call the ElevenLabs API with the current account's key, or another account's (`apiKey`). */
export async function el<T>(path: string, init: RequestInit = {}, apiKey?: string): Promise<T> {
  const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
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
export function bookingTools(r: { id: string; ragToken: string; timezone: string; bookingMeetingType: string; bookingQuestions: string; followUpOn: string; followUpChannel: string; agentType?: string }) {
  // The demo builder books into the rep's calendar: it passes its call session along.
  const session = r.agentType === "builder" ? { session_code: { type: "string", dynamic_variable: "session_code" } } : {};
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
            ...session,
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
            ...session,
            notes: str("Anything else the team should know before the call."),
          },
          required: ["start_iso", "caller_name", "caller_phone"],
        },
      },
    },
  };
}

/**
 * The company's own receptionist (bookingAddsToCrm): personalise a prospect's demo agent after
 * booking, and pass existing clients' requests to support (see src/lib/demo-builder.ts).
 */
export function salesTools(r: { id: string; ragToken: string }) {
  const base = `${appUrl()}/api/agent-tools/${r.id}`;
  const headers = { Authorization: `Bearer ${r.ragToken}` };
  const caller = {
    caller_name: str("Caller's full name."),
    caller_phone: str("Caller's phone number, as confirmed with them."),
    caller_email: str("Caller's email, if they gave one."),
    business_name: str("Caller's business name."),
    business_type: str("Type of business, e.g. auto repair, plumbing, retail store."),
  };
  return {
    keypad_entry: {
      type: "webhook",
      name: "keypad_entry",
      description: "The caller pressed keys on their phone keypad. Pass exactly the digits they pressed. Never read the digits back.",
      response_timeout_secs: 10,
      api_schema: {
        url: `${base}/keypad`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: { digits: str("The digits the caller keyed, in order (0-9 only)."), call_sid: { type: "string", dynamic_variable: "call_sid" } },
          required: ["digits"],
        },
      },
    },
    open_demo: {
      type: "webhook",
      name: "open_demo",
      description: "Only for a team member (caller type team): open the demo menu or a demo the team member asks for, by company name or extension. The app checks the caller is on the team.",
      response_timeout_secs: 10,
      api_schema: {
        url: `${base}/open-demo`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: { demo: str("The company name or extension they asked for, or \"menu\" for the demo menu."), call_sid: { type: "string", dynamic_variable: "call_sid" } },
          required: ["demo"],
        },
      },
    },
    get_personalization_questions: {
      type: "webhook",
      name: "get_personalization_questions",
      description: "After a demo is booked and the caller agrees to a few questions, get the questions to ask them about their business. Pass the same details used for the booking.",
      response_timeout_secs: 15,
      api_schema: {
        url: `${base}/questions`,
        method: "POST",
        request_headers: headers,
        request_body_schema: { type: "object", properties: caller, required: ["caller_phone"] },
      },
    },
    save_personalization_answers: {
      type: "webhook",
      name: "save_personalization_answers",
      description: "Save the caller's answers to the personalization questions so their demo agent knows their business. Call it once, after the last question (or when they want to stop).",
      response_timeout_secs: 20,
      api_schema: {
        url: `${base}/answers`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: {
            ...caller,
            answers: str("Every question you asked and the caller's answer in their words, one 'Question: answer' line each. Leave out questions they skipped."),
            conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
          },
          required: ["caller_phone", "answers"],
        },
      },
    },
    take_client_message: {
      type: "webhook",
      name: "take_client_message",
      description: "An existing client needs support, a change to their receptionist, or help with billing: send their request to the support team.",
      response_timeout_secs: 20,
      api_schema: {
        url: `${base}/client-message`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: {
            ...caller,
            request: str("What they need, in a sentence or two, as confirmed back to them."),
            urgency: { type: "string", enum: ["normal", "urgent"], description: "urgent only if their receptionist or phone line isn't working, or they say it can't wait." },
          },
          required: ["caller_phone", "request"],
        },
      },
    },
  };
}

/** Post-call fields ElevenLabs extracts from each call; the CRM uses them for outcomes and caller follow-ups. */
export const DATA_COLLECTION = {
  caller_name: { type: "string", description: "The caller's name as they gave it, or empty if not given." },
  callback_number: { type: "string", description: "Best callback number the caller gave, or empty." },
  caller_email: { type: "string", description: "The caller's email address if they gave one (as spelled back), or empty." },
  summary_delivery: { type: "string", enum: ["text", "email", "none"], description: "How the caller asked to receive a summary or confirmation: text, email, or none if they declined or weren't asked." },
  unanswered_questions: { type: "string", description: "Questions the caller asked that the agent couldn't answer from its knowledge base (it had to take a message or say the team would confirm), one per line in the caller's words. Empty if there were none." },
};

/** Follow-up agents also report how the lead went. */
export const FOLLOWUP_DATA_COLLECTION = {
  lead_outcome: {
    type: "string",
    enum: ["booked", "interested", "call_back", "not_interested", "do_not_call", "wrong_number"],
    description: "How the follow-up call ended: booked (an appointment or visit was booked), interested (wants it but nothing booked yet), call_back (asked to be called at another time), not_interested, do_not_call (asked not to be called again), wrong_number.",
  },
};

/**
 * Platform settings every agent gets, merged into what's already set in ElevenLabs so nothing
 * configured by hand is lost: our data-collection fields; the prompt-injection and stay-on-topic
 * guardrails on; no client-side overrides of the prompt, first message, voice or tools; and
 * conversations deleted after RETENTION_DAYS (calls are copied into the CRM within a day).
 */
export const RETENTION_DAYS = 90;

async function mergedPlatformSettings(agentId: string | null, followup = false) {
  const ours = followup ? { ...DATA_COLLECTION, ...FOLLOWUP_DATA_COLLECTION } : DATA_COLLECTION;
  type Settings = { data_collection?: Record<string, unknown>; guardrails?: Record<string, unknown>; privacy?: Record<string, unknown>; overrides?: { conversation_config_override?: Record<string, Record<string, unknown>> } & Record<string, unknown> };
  const current = agentId ? (await el<{ platform_settings?: Settings }>(`/agents/${agentId}`).catch(() => null))?.platform_settings ?? {} : {};
  const g = current.guardrails ?? {};
  const o = current.overrides ?? {};
  const cco = o.conversation_config_override ?? {};
  const agentOverride = (cco.agent ?? {}) as Record<string, unknown>;
  const retention = Number(current.privacy?.retention_days ?? -1);
  return {
    data_collection: { ...(current.data_collection ?? {}), ...ours },
    guardrails: { version: "1", ...g, focus: { ...((g.focus as object) ?? {}), is_enabled: true }, prompt_injection: { ...((g.prompt_injection as object) ?? {}), is_enabled: true } },
    overrides: {
      ...o,
      conversation_config_override: {
        ...cco,
        agent: { ...agentOverride, first_message: false, language: false, prompt: { ...((agentOverride.prompt as object) ?? {}), prompt: false, tool_ids: false, knowledge_base: false } },
        tts: { ...(cco.tts ?? {}), voice_id: false },
      },
    },
    // Shorter is fine (someone chose it); unlimited (-1) or longer becomes 90 days.
    // Calls aren't recorded: no call audio is kept, only the transcript and summary (deleted after 90 days).
    privacy: { ...(current.privacy ?? {}), record_voice: false, retention_days: retention > 0 && retention <= RETENTION_DAYS ? retention : RETENTION_DAYS },
  };
}

/** The live demo builder (src/lib/live-builder.ts): every tool acts on the call's session. */
export function builderTools(r: { id: string; ragToken: string }) {
  const headers = { Authorization: `Bearer ${r.ragToken}` };
  const tool = (name: string, action: string, description: string, extra: Record<string, unknown> = {}, required: string[] = []) => ({
    type: "webhook",
    name,
    description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${appUrl()}/api/agent-tools/${r.id}/builder/${action}`,
      method: "POST",
      request_headers: headers,
      request_body_schema: { type: "object", properties: { session_code: { type: "string", dynamic_variable: "session_code" }, ...extra }, required },
    },
  });
  return {
    get_build_questions: tool("get_build_questions", "questions", "Get the questions to ask about this business, once they've said now is a good time."),
    save_build_answers: tool("save_build_answers", "answers", "Save every question you asked and the owner's answer, after the last question.", { answers: str("One 'Question: answer' line per question asked, in their words. Leave out skipped ones.") }, ["answers"]),
    demo_status: tool("demo_status", "status", "Check whether their receptionist is ready to hear, and whether the rep is still on the call."),
    connect_live_demo: tool("connect_live_demo", "live-demo", "Connect them to their new receptionist, live, once demo_status says it's ready. You leave the call after this."),
    leave_call: tool("leave_call", "leave", "Leave the call when you're done and they don't want the live demo (or after handing back to the rep)."),
  };
}

/**
 * Owner mode on a client's own line (src/lib/owner-mode.ts): the owner, recognised by their
 * number, changes closures, hours, calendar blocks and what the agent says, or hears messages.
 * The app checks the live call's number itself; the agent's judgement is never trusted for that.
 */
export function ownerTools(r: { id: string; ragToken: string }) {
  const base = `${appUrl()}/api/agent-tools/${r.id}`;
  const headers = { Authorization: `Bearer ${r.ragToken}` };
  const callSid = { type: "string", dynamic_variable: "call_sid" };
  return {
    owner_request: {
      type: "webhook",
      name: "owner_request",
      description: "Only when the caller is the owner (caller role owner): a change the owner wants (closed days, special or regular hours, blocking calendar time, what to tell callers). First call with confirmed false, read back what it returns, and call again with confirmed true only after they say yes.",
      response_timeout_secs: 25,
      api_schema: {
        url: `${base}/owner-request`,
        method: "POST",
        request_headers: headers,
        request_body_schema: {
          type: "object",
          properties: {
            request: str("What the owner wants, in their words, with every detail they gave (dates, times, what to tell callers)."),
            confirmed: { type: "boolean", description: "false to get the read-back; true only after the owner said yes to it." },
            call_sid: callSid,
          },
          required: ["request", "confirmed"],
        },
      },
    },
    owner_messages: {
      type: "webhook",
      name: "owner_messages",
      description: "Only when the caller is the owner (caller role owner): today's call count and who is waiting for a call back.",
      response_timeout_secs: 10,
      api_schema: {
        url: `${base}/owner-messages`,
        method: "POST",
        request_headers: headers,
        request_body_schema: { type: "object", properties: { call_sid: callSid }, required: [] },
      },
    },
  };
}

/** A client's own receptionist answering their line (not ours, not a follow-up/builder/check-in agent). */
export function isClientInbound(r: { agentType?: string; bookingAddsToCrm?: boolean; lifecycle?: string }): boolean {
  return (r.agentType ?? "inbound") === "inbound" && !r.bookingAddsToCrm && r.lifecycle === "production";
}

/** The weekly owner check-in agent (src/lib/owner-checkin.ts). */
export function checkinTools(r: { id: string; ragToken: string }) {
  return {
    save_checkin_answers: {
      type: "webhook",
      name: "save_checkin_answers",
      description: "Save the owner's answers, once, after the last question (or when they want to stop).",
      response_timeout_secs: 30,
      api_schema: {
        url: `${appUrl()}/api/agent-tools/${r.id}/checkin`,
        method: "POST",
        request_headers: { Authorization: `Bearer ${r.ragToken}` },
        request_body_schema: {
          type: "object",
          properties: {
            checkin_id: { type: "string", dynamic_variable: "checkin_id" },
            answers: str("One line per question asked: the question's number and text, a colon, then the owner's answer in their words. Leave out skipped ones."),
          },
          required: ["answers"],
        },
      },
    },
  };
}

type ToolSource = Parameters<typeof bookingTools>[0] & { bookingEnabled: boolean; bookingAddsToCrm: boolean; elevenLabsToolIds: string; lifecycle: string };

/** Create or update the agent's webhook tools; returns every known tool id and the ones to attach. */
async function syncAgentTools(r: ToolSource): Promise<{ ids: ToolIds; attached: string[] }> {
  const ids: ToolIds = { ...safeJson<ToolIds>(r.elevenLabsToolIds, {}) }; // tools turned off stay known, just detached
  const wanted = { ...(r.bookingEnabled ? bookingTools(r) : {}), ...(r.bookingAddsToCrm ? salesTools(r) : {}), ...(r.agentType === "builder" ? builderTools(r) : {}), ...(r.agentType === "checkin" ? checkinTools(r) : {}), ...(isClientInbound(r) ? ownerTools(r) : {}) };
  const attached: string[] = [];
  for (const [name, tool_config] of Object.entries(wanted)) {
    const id = ids[name];
    let synced: string | null = null;
    if (id) {
      try {
        await el(`/tools/${id}`, { method: "PATCH", body: JSON.stringify({ tool_config }) });
        synced = id;
      } catch (e) {
        if (!String(e).includes(" 404 ")) throw e; // deleted in ElevenLabs: recreate below
      }
    }
    synced ??= (await el<{ id: string }>("/tools", { method: "POST", body: JSON.stringify({ tool_config }) })).id;
    ids[name] = synced;
    attached.push(synced);
  }
  return { ids, attached };
}

export function agentConfig(
  r: Parameters<typeof buildReceptionistPrompt>[0] &
    Partial<FollowupProfile> & { voiceId?: string | null; language: string; greeting: string; agentType?: string },
  docs: KbDocRef[],
  toolIds: string[] = [],
) {
  const followup = r.agentType === "followup";
  const builder = r.agentType === "builder"; // the live demo builder: businessName is our company's name
  const checkin = r.agentType === "checkin"; // the weekly owner check-in: businessName is our company's name too
  const greeting = checkin ? checkinOpening({ name: r.name, companyName: r.businessName }) : builder ? builderOpening({ name: r.name, companyName: r.businessName }) : followup ? followupOpening(r) : r.greeting || defaultGreeting({ businessName: r.businessName, name: r.name });
  const house = Boolean((r as { bookingAddsToCrm?: boolean }).bookingAddsToCrm) && !followup && !builder && !checkin;
  const clientLine = !house && isClientInbound(r as { agentType?: string; bookingAddsToCrm?: boolean; lifecycle?: string });
  // Our line: the opening is chosen per call (team members are greeted by name).
  const dynamicDefaults = house ? { caller_type: "new", team_name: "", opening: greeting, call_sid: "" } : clientLine ? { caller_role: "customer", owner_name: "", call_sid: "" } : checkin ? CHECKIN_DYNAMIC_DEFAULTS : builder ? BUILDER_DYNAMIC_DEFAULTS : followup ? { lead_first_name: "there", lead_name: "the person who contacted us", lead_request: "They asked to be contacted.", lead_id: "" } : null;
  return {
    name: `${r.businessName} — ${r.name}${followup ? " (follow-up)" : builder ? " (demo builder)" : checkin ? " (owner check-in)" : ""}`,
    conversation_config: {
      // Call protections: maximum call length and hang-up on silence (call-guard-rules.ts).
      ...conversationLimits(r as { maxCallMinutes?: number; silenceHangupSeconds?: number }),
      agent: {
        first_message: house ? "{{opening}}" : greeting,
        language: r.language,
        // Follow-up calls start with these filled from the lead; defaults keep test calls working.
        ...(dynamicDefaults ? { dynamic_variables: { dynamic_variable_placeholders: dynamicDefaults } } : {}),
        prompt: {
          prompt: checkin
            ? buildCheckinPrompt({ name: r.name, companyName: r.businessName })
            : builder
            ? buildBuilderPrompt({ name: r.name, companyName: r.businessName, persona: r.persona, bookingEnabled: Boolean(r.bookingEnabled), extraInstructions: r.extraInstructions })
            : followup ? buildFollowupPrompt(fullFollowupProfile(r)) : buildReceptionistPrompt(r),
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
  if (r.lifecycle === "expired") throw new Error("This demo has expired. Click Revive demo to bring it back.");
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

    const { ids: toolIds, attached } = await syncAgentTools(r);
    const platform = await mergedPlatformSettings(r.elevenLabsAgentId, r.agentType === "followup");
    const config = { ...agentConfig(r, docs, attached), platform_settings: platform };
    // If ElevenLabs ever rejects the security settings, still sync the agent (with a warning)
    // rather than leave it out of date.
    const send = async (body: object) => {
      if (r.elevenLabsAgentId) {
        try {
          await el(`/agents/${r.elevenLabsAgentId}`, { method: "PATCH", body: JSON.stringify(body) });
          return r.elevenLabsAgentId;
        } catch (err) {
          // Not in this ElevenLabs account (deleted, or the account changed): create it afresh.
          if (!String(err).includes(" 404 ")) throw err;
          console.warn("agent not found in ElevenLabs; creating a new one", r.id, r.elevenLabsAgentId);
        }
      }
      return (await el<{ agent_id: string }>("/agents/create", { method: "POST", body: JSON.stringify(body) })).agent_id;
    };
    let agentId: string;
    try {
      agentId = await send(config);
    } catch (err) {
      if (!/ (400|422) /.test(String(err))) throw err;
      console.warn("ElevenLabs rejected the security settings; synced without them", r.id, (err as Error).message.slice(0, 300));
      const basic = { ...config, platform_settings: { data_collection: platform.data_collection } };
      try {
        agentId = await send(basic);
      } catch (err2) {
        if (!/ (400|422) /.test(String(err2))) throw err2;
        // The call-length / silence settings (call protection) rejected: keep the agent in sync without them.
        console.warn("ElevenLabs rejected the call limits; synced without them", r.id, (err2 as Error).message.slice(0, 300));
        const { conversation: _c, turn: _t, ...rest } = basic.conversation_config as Record<string, unknown>;
        agentId = await send({ ...basic, conversation_config: rest });
      }
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
  const path = `/conversations/${encodeURIComponent(conversationId)}`;
  try {
    return await el<T>(path);
  } catch (err) {
    // A call from before the move to the new ElevenLabs account lives in the old one.
    const legacy = legacyElevenLabsKey();
    if (legacy && String(err).includes(" 404 ")) return el<T>(path, {}, legacy);
    throw err;
  }
}

/** The call recording as a streaming Response (audio/mpeg), or null if ElevenLabs has none. */
export async function fetchConversationAudio(conversationId: string, range?: string | null): Promise<Response | null> {
  const current = process.env.ELEVENLABS_API_KEY;
  if (!current) throw new Error("ELEVENLABS_API_KEY is not configured");
  // Recordings from before the move to the new ElevenLabs account are in the old one.
  for (const key of [current, legacyElevenLabsKey()].filter((k): k is string => Boolean(k))) {
    const res = await fetch(`${BASE}/conversations/${encodeURIComponent(conversationId)}/audio`, {
      headers: { "xi-api-key": key, ...(range ? { Range: range } : {}) },
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 422) continue;
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} on audio: ${(await res.text()).slice(0, 300)}`);
    return res;
  }
  return null;
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
