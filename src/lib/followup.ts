import "server-only";
import { randomBytes } from "node:crypto";
import type { Lead, Receptionist } from "@prisma/client";
import { db } from "./db";
import { dialerCallerId } from "./dialer";
import { registerTwilioCall } from "./elevenlabs";
import { leadAlertNumbers, sendFollowUp } from "./follow-up";
import { leadRequestText, leadStatusFromOutcome, mapLeadFields, missedLeadText, nextCallTime, type LeadStatus } from "./followup-rules";
import { formatPhone } from "./demo-line";
import { getSetting, setSetting } from "./settings";
import { dialableNumber, escapeXml, twilioApi, twiml } from "./twilio";
import { appBase } from "./twilio-request";

// Follow-up agent (speed to lead): a website form arrives → within minutes the agent calls the
// person, learns what they need and books the next step.
//
//   form → /api/leads/<key> → intakeLead → (calling hours?) startFollowupCall → Twilio calls them
//   → /api/voice/followup: person → ElevenLabs agent with the lead's details; voicemail → short message
//   → /api/voice/followup/status: not reached → retry once, then text them + tell the owner
//   → post-call webhook (saveCallLog → linkLeadToCall): booked / interested / not interested…

const RETRY_AFTER_MS = 2 * 60_000;
const DUPLICATE_WINDOW_MS = 12 * 3_600_000;

function callerIdFor(r: Receptionist): string | null {
  return r.businessNumber ?? dialerCallerId();
}

async function setStatus(leadId: string, status: LeadStatus, data: Partial<Lead> = {}) {
  return db.lead.update({ where: { id: leadId }, data: { status, ...data } });
}

/** Has this person asked not to be called or texted by this business? */
async function doNotContact(r: Receptionist, phone: string): Promise<boolean> {
  const [optedOut, refused] = await Promise.all([
    db.smsOptOut.findUnique({ where: { receptionistId_phone: { receptionistId: r.id, phone } } }),
    db.lead.findFirst({ where: { receptionistId: r.id, phone, status: "DO_NOT_CALL" }, select: { id: true } }),
  ]);
  return Boolean(optedOut || refused);
}

export type IntakeResult = { lead: Lead; action: "calling" | "queued" | "duplicate" | "skipped" };

/**
 * Store a website lead and decide what happens: call now (after the configured short delay),
 * wait for calling hours, or not call (no valid number, duplicate, asked not to be called).
 * The caller runs `after(() => callAfterDelay(...))` for the "calling" case.
 */
export async function intakeLead(r: Receptionist, raw: Record<string, unknown>, opts: { source: string; consent: boolean; test?: boolean }): Promise<IntakeResult> {
  const fields = mapLeadFields(raw);
  const phone = fields.phone ? dialableNumber(fields.phone) : null;
  const base = {
    receptionistId: r.id,
    name: fields.name,
    phone,
    email: fields.email?.toLowerCase() ?? null,
    message: fields.message ?? "",
    details: JSON.stringify(fields.details),
    source: opts.source,
    consent: opts.consent,
  };
  if (!phone) {
    const lead = await db.lead.create({ data: { ...base, status: "SKIPPED", statusNote: fields.phone ? "Not a Canadian or US number we can call" : "No phone number on the form" } });
    await alertOwner(r, `${r.businessName}: new website lead from ${fields.name ?? "someone"} with no callable number. ${fields.email ? `Email: ${fields.email}` : ""}`.trim(), lead.id);
    return { lead, action: "skipped" };
  }
  const recent = opts.test ? null : await db.lead.findFirst({ where: { receptionistId: r.id, phone, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } }, orderBy: { createdAt: "desc" } });
  if (recent) {
    const lead = await db.lead.create({ data: { ...base, status: "SKIPPED", statusNote: "Same person sent the form again; one call is enough" } });
    return { lead, action: "duplicate" };
  }
  if (await doNotContact(r, phone)) {
    const lead = await db.lead.create({ data: { ...base, status: "SKIPPED", statusNote: "This person asked not to be contacted" } });
    return { lead, action: "skipped" };
  }
  // A test lead from the team calls straight away, whatever the time.
  const when = opts.test ? new Date() : nextCallTime(r.followupCallHours, r.timezone);
  const now = Date.now();
  if (when && when.getTime() <= now) {
    const lead = await db.lead.create({ data: { ...base, status: "NEW" } });
    return { lead, action: "calling" };
  }
  const lead = await db.lead.create({ data: { ...base, status: "QUEUED", nextAttemptAt: when, statusNote: when ? `Calling hours start ${when.toISOString()}` : "No calling hours set" } });
  await alertOwner(r, `${r.businessName}: new website lead, ${fields.name ?? phone}. It's outside calling hours, so ${r.name} will call them when calling hours start.`, lead.id);
  return { lead, action: "queued" };
}

/** Wait the configured delay (it feels less robotic than an instant call), then call. */
export async function callAfterDelay(r: Receptionist, leadId: string) {
  const delay = Math.min(240, Math.max(0, r.followupDelaySeconds)) * 1000;
  if (delay) await new Promise((res) => setTimeout(res, delay));
  await startFollowupCall(leadId);
}

/** Place one call attempt to a lead (Twilio), with answering-machine detection. */
export async function startFollowupCall(leadId: string): Promise<void> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { receptionist: true } });
  if (!lead || !lead.phone || !["NEW", "QUEUED", "RETRY"].includes(lead.status)) return;
  const r = lead.receptionist;
  if (!r.elevenLabsAgentId) {
    await setStatus(lead.id, "FAILED", { statusNote: "The follow-up agent isn't synced to ElevenLabs yet" });
    return;
  }
  const from = callerIdFor(r);
  if (!from) {
    await setStatus(lead.id, "FAILED", { statusNote: "No number to call from: give the follow-up agent a business line" });
    return;
  }
  if (await doNotContact(r, lead.phone)) {
    await setStatus(lead.id, "SKIPPED", { statusNote: "This person asked not to be contacted" });
    return;
  }
  // Claim the attempt so two triggers (delay timer + queue sweep) can't both dial.
  const claimed = await db.lead.updateMany({ where: { id: lead.id, status: lead.status, attempts: lead.attempts }, data: { status: "CALLING", attempts: { increment: 1 }, calledAt: new Date(), nextAttemptAt: null } });
  if (!claimed.count) return;
  const q = `lead=${encodeURIComponent(lead.id)}`;
  try {
    const call = await twilioApi<{ sid: string }>("/Calls.json", {
      form: {
        To: lead.phone,
        From: from,
        Url: `${appBase()}/api/voice/followup?${q}`,
        StatusCallback: `${appBase()}/api/voice/followup/status?${q}`,
        MachineDetection: "DetectMessageEnd",
        MachineDetectionTimeout: "20",
        Timeout: "25",
      },
    });
    await db.lead.update({ where: { id: lead.id }, data: { lastCallSid: call.sid } });
  } catch (err) {
    console.error("follow-up call failed to start", lead.id, err);
    await setStatus(lead.id, "FAILED", { statusNote: `Call couldn't be placed: ${(err as Error).message.slice(0, 200)}` });
  }
}

/** TwiML when the lead's phone answers: a person gets the agent; voicemail gets a short message. */
export async function followupTwiml(leadId: string, answeredBy: string): Promise<string> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { receptionist: true } });
  if (!lead || !lead.phone) return twiml("<Hangup/>");
  const r = lead.receptionist;
  const first = lead.name?.split(/\s+/)[0] ?? null;
  const from = callerIdFor(r) ?? "";
  if (/^machine|^fax/.test(answeredBy)) {
    await db.lead.update({ where: { id: lead.id }, data: { statusNote: "Reached voicemail" } });
    const callBack = r.businessNumber ? formatPhone(r.businessNumber) : null;
    const message = `Hi${first ? ` ${first}` : ""}, this is ${r.name} calling from ${r.businessName} about the request you sent on our website. We'll try you again shortly${callBack ? `, or call us back at ${callBack}` : ""}. Thanks!`;
    return twiml(`<Say voice="Google.en-US-Chirp3-HD-Charon">${escapeXml(message)}</Say><Hangup/>`);
  }
  try {
    return await registerTwilioCall(r.elevenLabsAgentId!, from, lead.phone, {
      direction: "outbound",
      dynamicVariables: {
        lead_id: lead.id,
        lead_first_name: first ?? "there",
        lead_name: lead.name ?? "the person who contacted us",
        lead_request: leadRequestText({ message: lead.message || null, details: JSON.parse(lead.details) as Record<string, string>, name: lead.name, phone: lead.phone, email: lead.email }),
      },
    });
  } catch (err) {
    console.error("follow-up: register-call failed", err);
    await db.lead.update({ where: { id: lead.id }, data: { statusNote: "The agent couldn't be connected" } });
    return twiml(`<Say voice="Google.en-US-Chirp3-HD-Charon">${escapeXml(`Sorry, we're having trouble connecting. ${r.businessName} will call you back shortly.`)}</Say><Hangup/>`);
  }
}

/**
 * The call ended. Reached a person: the post-call webhook fills in the result. Not reached
 * (no answer, busy, voicemail, failed): try again once a couple of minutes later, then text the
 * lead and tell the owner.
 */
export async function handleFollowupStatus(leadId: string, params: Record<string, string>): Promise<{ retry: boolean }> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { receptionist: true } });
  if (!lead || lead.status !== "CALLING") return { retry: false };
  const reached = params.CallStatus === "completed" && !/^machine|^fax/.test(params.AnsweredBy ?? "") && lead.statusNote !== "Reached voicemail";
  if (reached) {
    await setStatus(lead.id, "CONNECTED", { statusNote: "Talked to them; waiting for the call summary" });
    return { retry: false };
  }
  const r = lead.receptionist;
  if (lead.attempts < Math.max(1, r.followupMaxAttempts)) {
    await setStatus(lead.id, "RETRY", { nextAttemptAt: new Date(Date.now() + RETRY_AFTER_MS), statusNote: `No answer (${params.AnsweredBy?.startsWith("machine") ? "voicemail" : params.CallStatus}); trying again` });
    return { retry: true };
  }
  await setStatus(lead.id, "NO_ANSWER", { statusNote: `Couldn't reach them after ${lead.attempts} tries` });
  const first = lead.name?.split(/\s+/)[0] ?? null;
  if (r.followupTextIfMissed && lead.phone) {
    await sendFollowUp(r, { kind: "call", channel: "sms", to: lead.phone, subject: "", body: missedLeadText({ firstName: first, businessName: r.businessName, callBack: r.businessNumber ? formatPhone(r.businessNumber) : null }) });
  }
  await alertOwner(r, `${r.businessName}: couldn't reach website lead ${lead.name ?? lead.phone} after ${lead.attempts} calls${r.followupTextIfMissed ? "; texted them to call back" : ""}. ${lead.phone}`, lead.id);
  return { retry: false };
}

/** After the retry wait: call again if the lead is still waiting. */
export async function retryAfterWait(leadId: string) {
  await new Promise((res) => setTimeout(res, RETRY_AFTER_MS));
  await startFollowupCall(leadId);
}

/** Post-call webhook for a follow-up agent's call: record how it went on the lead. */
export async function linkLeadToCall(data: { conversation_id?: string; conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> } | null; analysis?: { data_collection_results?: Record<string, { value?: unknown }>; transcript_summary?: string } }, callOutcome: string) {
  const leadId = data.conversation_initiation_client_data?.dynamic_variables?.lead_id;
  if (typeof leadId !== "string" || !leadId || !data.conversation_id) return;
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { receptionist: true } });
  if (!lead) return;
  const status = leadStatusFromOutcome(data.analysis?.data_collection_results?.lead_outcome?.value, callOutcome);
  await db.lead.update({
    where: { id: lead.id },
    data: { status, conversationId: data.conversation_id, summary: data.analysis?.transcript_summary ?? lead.summary, statusNote: "" },
  });
  if (status === "DO_NOT_CALL" && lead.phone) {
    await db.smsOptOut.upsert({ where: { receptionistId_phone: { receptionistId: lead.receptionistId, phone: lead.phone } }, create: { receptionistId: lead.receptionistId, phone: lead.phone }, update: {} });
  }
}

async function alertOwner(r: Receptionist, body: string, leadId: string) {
  for (const to of leadAlertNumbers(r)) {
    await sendFollowUp(r, { kind: "owner_alert", channel: "sms", to, subject: "", body, conversationId: `lead:${leadId}` }).catch((e) => console.warn("lead owner alert", e));
  }
}

/**
 * Call leads whose turn has come: ones that arrived outside calling hours, and retries whose
 * timer didn't run. Runs from the daily job, on each new lead, and when the team opens the CRM.
 */
export async function processDueLeads(limit = 10) {
  const due = await db.lead.findMany({
    where: { status: { in: ["QUEUED", "RETRY"] }, nextAttemptAt: { lte: new Date() } },
    include: { receptionist: { select: { followupCallHours: true, timezone: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  let started = 0;
  for (const l of due) {
    const when = nextCallTime(l.receptionist.followupCallHours, l.receptionist.timezone);
    if (when && when.getTime() <= Date.now()) {
      await startFollowupCall(l.id);
      started++;
    } else {
      await db.lead.update({ where: { id: l.id }, data: { nextAttemptAt: when } });
    }
  }
  return started;
}

/** processDueLeads at most every 2 minutes (it's called from page loads). */
export async function processDueLeadsThrottled() {
  const last = Number((await getSetting("followup.lastSweep")) ?? 0);
  if (Date.now() - last < 120_000) return 0;
  await setSetting("followup.lastSweep", String(Date.now()));
  return processDueLeads().catch((e) => {
    console.error("follow-up sweep", e);
    return 0;
  });
}

/** A random public key for the website form's address. */
export function newLeadFormKey(): string {
  return `lf_${randomBytes(12).toString("base64url")}`;
}
