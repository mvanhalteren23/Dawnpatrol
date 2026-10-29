import "server-only";
import { db } from "./db";
import { callerNumber, classifyCall, transcriptText, type PostCallData } from "./calls";
import { checkMinuteUsage, sendCallFollowUp, sendLeadAlert } from "./follow-up";
import { linkLeadToCall } from "./followup";

type ReceptionistRef = { id: string; demoExtension: string | null };

/**
 * Save one finished ElevenLabs conversation as a CallLog. Shared by the post-call webhook and the
 * pull-based sync, so a call that arrives both ways is stored once (externalId is unique).
 * Returns null if the conversation is not finished yet.
 */
export async function saveCallLog(receptionist: ReceptionistRef, data: PostCallData) {
  const conversationId = data.conversation_id;
  if (!conversationId) return null;
  if (data.status && data.status !== "done") return null;

  const { outcome, followUpNeeded } = classifyCall(data);
  const collected = data.analysis?.data_collection_results ?? {};
  const name = collected.caller_name?.value ?? collected.name?.value ?? collected.visitor_name?.value;
  const startedAt = data.metadata?.start_time_unix_secs ? new Date(data.metadata.start_time_unix_secs * 1000) : new Date();
  const fields = {
    callerNumber: callerNumber(data),
    callerName: typeof name === "string" && name ? name : null,
    startedAt,
    durationSec: data.metadata?.call_duration_secs ?? 0,
    summary: data.analysis?.transcript_summary ?? "",
    transcript: transcriptText(data),
    outcome,
  };
  const call = await db.callLog.upsert({
    where: { externalId: conversationId },
    create: {
      receptionistId: receptionist.id,
      externalId: conversationId,
      ...fields,
      // Demo-line calls are prospects trying the product, not the client's customers.
      followUpNeeded: receptionist.demoExtension ? false : followUpNeeded,
    },
    // Fill in anything a first, partial save missed, but never undo a follow-up the user recorded.
    update: { summary: fields.summary || undefined, transcript: fields.transcript || undefined, durationSec: fields.durationSec || undefined },
  });
  const full = await db.receptionist.findUnique({ where: { id: receptionist.id } });
  if (full) {
    if (full.agentType === "followup") await linkLeadToCall(data, outcome).catch((e) => console.error("lead update failed", e));
    await sendCallFollowUp(full, call, collected).catch((e) => console.error("call follow-up failed", e));
    await sendLeadAlert(full, call).catch((e) => console.error("lead alert failed", e));
    if (!full.demoExtension) await checkMinuteUsage(full).catch((e) => console.error("minute usage check failed", e));
  }
  return call;
}
