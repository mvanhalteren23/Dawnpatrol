// Classify ElevenLabs post-call payloads into CRM call outcomes (pure; unit tested).

export type PostCallData = {
  agent_id?: string;
  conversation_id?: string;
  status?: string;
  transcript?: { role: string; message?: string | null; time_in_call_secs?: number }[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: { external_number?: string; from_number?: string } | null;
  };
  conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> } | null;
  analysis?: {
    transcript_summary?: string;
    call_successful?: string;
    data_collection_results?: Record<string, { value?: unknown }>;
  };
};

export function classifyCall(data: PostCallData): { outcome: string; followUpNeeded: boolean } {
  const summary = (data.analysis?.transcript_summary ?? "").toLowerCase();
  const transcript = (data.transcript ?? []).map((t) => t.message ?? "").join(" ").toLowerCase();
  const text = `${summary} ${transcript}`;
  const collected = data.analysis?.data_collection_results ?? {};
  const explicit = collected.outcome?.value;
  if (typeof explicit === "string" && explicit) {
    const o = explicit.toUpperCase().replace(/\s+/g, "_");
    return { outcome: o, followUpNeeded: o === "MESSAGE_TAKEN" || o === "MISSED_OPPORTUNITY" };
  }
  const duration = data.metadata?.call_duration_secs ?? 0;
  const callerTurns = (data.transcript ?? []).filter((t) => t.role === "user" && t.message).length;

  if (/\b(spam|robocall|telemarket|extended warranty)\b/.test(text)) return { outcome: "SPAM", followUpNeeded: false };
  if (/\b(booked|scheduled|appointment (is )?(set|confirmed)|confirmed (for|the) )/.test(summary)) return { outcome: "BOOKED", followUpNeeded: false };
  if (/\b(transferred|transfer(ring)? (you|the call))\b/.test(text)) return { outcome: "TRANSFERRED", followUpNeeded: false };
  if (/\b(take a message|left a message|call(ing)? (them|you) back|callback|follow up)\b/.test(text)) return { outcome: "MESSAGE_TAKEN", followUpNeeded: true };
  // Caller hung up early or the agent couldn't help: the classic lost opportunity.
  if (data.analysis?.call_successful === "failure" || (callerTurns <= 1 && duration < 20)) return { outcome: "MISSED_OPPORTUNITY", followUpNeeded: true };
  return { outcome: "ANSWERED", followUpNeeded: false };
}

export function transcriptText(data: PostCallData): string {
  return (data.transcript ?? [])
    .filter((t) => t.message)
    // Drop expressive voice tags such as "[happy]" or "[laugh]" so the transcript reads cleanly.
    .map((t) => `${t.role === "agent" ? "Receptionist" : "Caller"}: ${(t.message ?? "").replace(/\[[a-z][a-z ]{0,20}\]\s*/gi, "").trim()}`)
    .join("\n");
}

export function callerNumber(data: PostCallData): string | null {
  return data.metadata?.phone_call?.external_number ?? data.metadata?.phone_call?.from_number ?? null;
}
