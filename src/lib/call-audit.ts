import "server-only";
import type { AuditCall, CallAudit } from "@prisma/client";
import { db } from "./db";
import { dialerCallerId } from "./dialer";
import { elevenLabsConfigured, getConversation, listConversations, registerTwilioCall, upsertAgent } from "./elevenlabs";
import { analyzeAuditCall, writeAuditReport, type AuditCallAnalysis, type AuditReport } from "./ai";
import {
  AUDIT_AGENT_VERSION,
  AUDIT_FIRST_MESSAGE,
  auditCallerPrompt,
  auditStats,
  auditStatusFromTwilio,
  auditTranscript,
  missedCallBaseline,
  scenarioByKey,
  type AuditCallResult,
  type CallAnalysis,
} from "./audit-rules";
import { getSetting, setSetting } from "./settings";
import { dialableNumber, twilioApi, twiml } from "./twilio";
import { appBase } from "./twilio-request";
import { safeJson } from "./utils";

// One-week call audit ("mystery shopper"). We call the business's public number as customers
// would; nothing changes on their side.
//
//   plan (audit-rules) → processAudits (every ~20 min from GitHub Actions, daily cron, CRM loads)
//   → startAuditCall: Twilio calls their number with answering-machine detection
//   → /api/voice/audit: a person answered → the shared audit-caller agent (ElevenLabs) plays the
//     call's scenario; voicemail → hang up (we only record that it went to voicemail)
//   → /api/voice/audit/status: answered / voicemail / no answer / busy, ring time, length
//   → processAudits: fetch the transcript from ElevenLabs, analyse it (Claude), and once every
//     call is done, write the report and the knowledge facts.

const LATE_LIMIT_MS = 60 * 60_000; // a slot can run up to an hour late; after that it moves to the next day
const STUCK_MS = 15 * 60_000;
const GAP_MS = 4 * 60_000; // never two calls to the same business within a few minutes

export type StoredAnalysis = AuditCallAnalysis & { model?: string };
export type StoredReport = AuditReport & { model?: string; tokensIn?: number; tokensOut?: number; generatedAt?: string };

export function parseAnalysis(a: AuditCall): StoredAnalysis | null {
  return a.analysis ? safeJson<StoredAnalysis | null>(a.analysis, null) : null;
}

export function toResult(c: AuditCall): AuditCallResult {
  const a = parseAnalysis(c);
  const analysis: CallAnalysis | null = a
    ? {
        handledScore: a.handledScore,
        questionsAsked: a.questions.length,
        answeredQuestions: a.questions.filter((q) => q.answered === "yes").length + a.questions.filter((q) => q.answered === "partly").length * 0.5,
        offeredAppointment: a.offeredAppointment,
        askedForContact: a.askedForContact,
        putOnHold: a.putOnHold,
        missedOpportunity: a.missedOpportunity,
      }
    : null;
  return { status: c.status, afterHours: c.afterHours, window: c.window, ringSeconds: c.ringSeconds, durationSec: c.durationSec, analysis };
}

/** Test calls to the team aren't part of the audit's numbers or report. */
export function realCalls(calls: AuditCall[]): AuditCall[] {
  return calls.filter((c) => !c.toNumber);
}

export function auditResults(audit: CallAudit, calls: AuditCall[]) {
  const stats = auditStats(realCalls(calls).map(toResult));
  const baseline = missedCallBaseline(stats, audit);
  return { stats, baseline };
}

/** The shared ElevenLabs agent that plays the customer. Created on first use, updated when its version changes. */
export async function ensureAuditAgent(): Promise<string> {
  const [id, version] = await Promise.all([getSetting("audit.agentId"), getSetting("audit.agentVersion")]);
  if (id && version === AUDIT_AGENT_VERSION) return id;
  const base = {
    name: "Call audit — test caller",
    conversation_config: {
      agent: {
        first_message: AUDIT_FIRST_MESSAGE,
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: { caller_name: "Sam", business_name: "the business", scenario: "a general question", questions: "- What are your hours?", opening: "I had a quick question.", audit_call_id: "" } },
        prompt: { prompt: auditCallerPrompt(), ...(process.env.ELEVENLABS_LLM ? { llm: process.env.ELEVENLABS_LLM } : {}) },
      },
      conversation: { max_duration_seconds: 300 },
      ...(process.env.ELEVENLABS_AUDIT_VOICE_ID || process.env.ELEVENLABS_DEFAULT_VOICE_ID ? { tts: { voice_id: process.env.ELEVENLABS_AUDIT_VOICE_ID || process.env.ELEVENLABS_DEFAULT_VOICE_ID } } : {}),
    },
  };
  // Let the caller hang up itself when it's done. If this ElevenLabs API version rejects the
  // built-in tool, fall back to the 5-minute limit (the business hangs up first anyway).
  const withEndCall = structuredClone(base) as typeof base & { conversation_config: { agent: { prompt: Record<string, unknown> } } };
  withEndCall.conversation_config.agent.prompt.built_in_tools = { end_call: { type: "system", name: "end_call", description: "End the call once you've said goodbye.", params: { system_tool_type: "end_call" } } };
  let agentId: string;
  try {
    agentId = await upsertAgent(id, withEndCall);
  } catch (err) {
    console.warn("audit agent: end_call tool rejected, retrying without it", err);
    agentId = await upsertAgent(id, base);
  }
  await setSetting("audit.agentId", agentId);
  await setSetting("audit.agentVersion", AUDIT_AGENT_VERSION);
  return agentId;
}

function callerIds(audit: CallAudit): string[] {
  const own = audit.callerIds.split(/[\n,]/).map((n) => dialableNumber(n.trim())).filter((n): n is string => Boolean(n));
  const fallback = dialerCallerId();
  return own.length ? own : fallback ? [fallback] : [];
}

/** Place one audit call. */
export async function startAuditCall(callId: string): Promise<void> {
  const call = await db.auditCall.findUnique({ where: { id: callId }, include: { audit: true } });
  if (!call || call.status !== "PLANNED" || (call.audit.status !== "RUNNING" && !call.toNumber)) return;
  const audit = call.audit;
  const from = callerIds(audit);
  if (!from.length) {
    await db.auditCall.update({ where: { id: call.id }, data: { status: "FAILED", note: "No number to call from: set up the dialer number or add caller IDs" } });
    return;
  }
  const index = await db.auditCall.count({ where: { auditId: audit.id, calledAt: { not: null } } });
  const fromNumber = from[index % from.length]!;
  const claimed = await db.auditCall.updateMany({ where: { id: call.id, status: "PLANNED" }, data: { status: "CALLING", calledAt: new Date(), fromNumber } });
  if (!claimed.count) return;
  const q = `call=${encodeURIComponent(call.id)}`;
  try {
    const created = await twilioApi<{ sid: string }>("/Calls.json", {
      form: {
        To: call.toNumber ?? audit.targetNumber,
        From: fromNumber,
        Url: `${appBase()}/api/voice/audit?${q}`,
        StatusCallback: `${appBase()}/api/voice/audit/status?${q}`,
        MachineDetection: "Enable",
        MachineDetectionTimeout: "8",
        Timeout: "30", // about 5 rings: longer than most callers wait
      },
    });
    await db.auditCall.update({ where: { id: call.id }, data: { callSid: created.sid } });
  } catch (err) {
    console.error("audit call failed to start", call.id, err);
    await db.auditCall.update({ where: { id: call.id }, data: { status: "FAILED", note: `Couldn't place the call: ${(err as Error).message.slice(0, 200)}` } });
  }
}

/** Their phone answered. A person gets the test caller; voicemail or a fax tone gets a hang-up. */
export async function auditTwiml(callId: string, params: Record<string, string>): Promise<string> {
  const call = await db.auditCall.findUnique({ where: { id: callId }, include: { audit: true } });
  if (!call || call.status !== "CALLING") return twiml("<Hangup/>");
  const detectMs = Number(params.MachineDetectionDuration ?? 0) || 0;
  const answeredAt = new Date(Date.now() - detectMs);
  const ringSeconds = call.calledAt ? Math.max(0, Math.round((answeredAt.getTime() - call.calledAt.getTime()) / 1000) - 1) : null;
  const answeredBy = params.AnsweredBy ?? "unknown";
  await db.auditCall.update({ where: { id: call.id }, data: { answeredAt, ringSeconds, answeredBy } });
  if (/^machine|^fax/.test(answeredBy)) return twiml("<Hangup/>");
  const a = call.audit;
  const s = scenarioByKey(a.industry, a.customScenarios, call.scenarioKey);
  try {
    return await registerTwilioCall(await ensureAuditAgent(), call.fromNumber ?? "", call.toNumber ?? a.targetNumber, {
      direction: "outbound",
      dynamicVariables: {
        audit_call_id: call.id,
        caller_name: call.callerName,
        business_name: a.businessName,
        scenario: `${s.title}. ${s.opening} (What you want: ${s.goal}.)`,
        questions: (s.questions.length ? s.questions : [s.opening]).map((x) => `- ${x}`).join("\n"),
        opening: s.opening,
      },
    });
  } catch (err) {
    console.error("audit: register-call failed", err);
    await db.auditCall.update({ where: { id: call.id }, data: { note: "Answered, but the test caller couldn't be connected" } });
    return twiml("<Hangup/>");
  }
}

/** The call ended: record how. */
export async function handleAuditStatus(callId: string, params: Record<string, string>) {
  const call = await db.auditCall.findUnique({ where: { id: callId } });
  if (!call || call.status !== "CALLING") return;
  const status = auditStatusFromTwilio(params.CallStatus ?? "", params.AnsweredBy ?? call.answeredBy);
  await db.auditCall.update({
    where: { id: call.id },
    data: {
      status,
      durationSec: Number(params.CallDuration ?? 0) || 0,
      answeredBy: params.AnsweredBy ?? call.answeredBy,
      note: status === "FAILED" ? `Twilio: ${params.CallStatus ?? "failed"}` : call.note,
    },
  });
}

/** Link finished ElevenLabs conversations to answered audit calls (by the audit_call_id we passed in). */
async function collectTranscripts(audit: CallAudit & { calls: AuditCall[] }, agentId: string) {
  const waiting = audit.calls.filter((c) => c.status === "ANSWERED" && !c.conversationId && c.calledAt && Date.now() - c.calledAt.getTime() > 60_000);
  if (!waiting.length) return;
  const earliest = Math.min(...waiting.map((c) => c.calledAt!.getTime()));
  const convs = await listConversations(agentId, Math.floor(earliest / 1000) - 120);
  const known = new Set((await db.auditCall.findMany({ where: { conversationId: { in: convs.map((c) => c.conversation_id) } }, select: { conversationId: true } })).map((c) => c.conversationId));
  const wanted = new Set(waiting.map((c) => c.id));
  for (const conv of convs) {
    if (known.has(conv.conversation_id) || (conv.status && conv.status !== "done")) continue;
    const data = await getConversation<{
      transcript?: { role: string; message?: string | null }[];
      metadata?: { call_duration_secs?: number };
      analysis?: { transcript_summary?: string };
      conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> } | null;
    }>(conv.conversation_id);
    const id = data.conversation_initiation_client_data?.dynamic_variables?.audit_call_id;
    if (typeof id !== "string" || !wanted.has(id)) continue;
    await db.auditCall.update({
      where: { id },
      data: { conversationId: conv.conversation_id, transcript: auditTranscript(data.transcript ?? []), summary: data.analysis?.transcript_summary ?? "", durationSec: data.metadata?.call_duration_secs ?? undefined },
    });
  }
  // A call answered more than an hour ago with no conversation: the test caller never connected.
  for (const c of waiting) {
    if (Date.now() - c.calledAt!.getTime() > 3_600_000 && !c.note) await db.auditCall.update({ where: { id: c.id }, data: { note: "No recording: the test caller didn't connect" } });
  }
}

async function analyzeCalls(audit: CallAudit & { calls: AuditCall[] }, budget: { left: number }) {
  for (const c of audit.calls) {
    if (budget.left <= 0) return;
    if (c.status !== "ANSWERED" || !c.transcript.trim() || c.analysis) continue;
    budget.left--;
    const s = scenarioByKey(audit.industry, audit.customScenarios, c.scenarioKey);
    try {
      const a = await analyzeAuditCall({ businessName: audit.businessName, scenario: `${s.title}: ${s.opening}`, transcript: c.transcript });
      await db.auditCall.update({ where: { id: c.id }, data: { analysis: JSON.stringify(a) } });
    } catch (err) {
      console.error("audit call analysis failed", c.id, err);
    }
  }
}

/** All calls finished: write the owner-facing report. */
export async function writeReport(auditId: string) {
  const audit = await db.callAudit.findUniqueOrThrow({ where: { id: auditId }, include: { calls: { orderBy: { scheduledAt: "asc" } } } });
  const { stats, baseline } = auditResults(audit, audit.calls);
  const lines = realCalls(audit.calls).map((c) => {
    const a = parseAnalysis(c);
    const when = c.calledAt ?? c.scheduledAt;
    return [
      `## Call ${when.toISOString()} (${c.window}${c.afterHours ? ", after hours" : ""}) — ${c.status}${c.ringSeconds != null ? `, answered after ${c.ringSeconds}s` : ""}`,
      `Scenario: ${scenarioByKey(audit.industry, audit.customScenarios, c.scenarioKey).title}`,
      a ? `Score ${a.handledScore}/5. ${a.summary} Offered appointment: ${a.offeredAppointment}. Took contact details: ${a.askedForContact}. On hold: ${a.putOnHold}. Missed opportunity: ${a.missedOpportunity ?? "none"}.` : c.note,
      a ? a.questions.map((q) => `Q: ${q.question} → ${q.answered}: ${q.answer}`).join("\n") : "",
      a?.facts.length ? `Facts: ${a.facts.map((f) => `[${f.category}] ${f.title}: ${f.content}`).join(" | ")}` : "",
    ].filter(Boolean).join("\n");
  });
  const material = `# Stats\n${JSON.stringify(stats, null, 1)}\n\n# Missed-call baseline (assumptions: ${audit.callsPerWeek} calls/week, ${Math.round(audit.afterHoursShare * 100)}% after hours, ${Math.round(audit.newCustomerShare * 100)}% new customers, ${Math.round(audit.bookingRate * 100)}% of those book, average job $${Math.round(audit.avgJobValueCents / 100)})\n${JSON.stringify(baseline)}\n\n# Calls\n${lines.join("\n\n")}`;
  const report = await writeAuditReport({ businessName: audit.businessName, material });
  await db.callAudit.update({ where: { id: audit.id }, data: { status: "DONE", report: JSON.stringify({ ...report, generatedAt: new Date().toISOString() }), error: null } });
}

/** Move a slot that was missed (no trigger ran in time) to the same time the next day, once. */
async function rescheduleOrSkip(c: AuditCall) {
  if (c.note.startsWith("Moved")) {
    await db.auditCall.update({ where: { id: c.id }, data: { status: "SKIPPED", note: "Skipped: the scheduler didn't run in time" } });
    return;
  }
  await db.auditCall.update({ where: { id: c.id }, data: { scheduledAt: new Date(c.scheduledAt.getTime() + 86_400_000), note: "Moved a day: the scheduler didn't run in time" } });
}

/**
 * Advance every running audit: place calls that are due, tidy up stuck ones, collect transcripts,
 * analyse answered calls, and write the report when everything's in. Safe to run often.
 */
export async function processAudits(opts: { analyzeBudget?: number } = {}) {
  const audits = await db.callAudit.findMany({ where: { status: { in: ["RUNNING", "ANALYZING"] } }, include: { calls: { orderBy: { scheduledAt: "asc" } } } });
  const budget = { left: opts.analyzeBudget ?? 6 };
  const out = { audits: audits.length, started: 0, errors: [] as string[] };
  for (const audit of audits) {
    try {
      const now = Date.now();
      for (const c of audit.calls) {
        if (c.status === "CALLING" && c.calledAt && now - c.calledAt.getTime() > STUCK_MS) {
          await db.auditCall.update({ where: { id: c.id }, data: { status: "FAILED", note: "No result from Twilio" } });
        }
      }
      if (audit.status === "RUNNING") {
        const busy = audit.calls.some((c) => c.status === "CALLING" || (c.calledAt && now - c.calledAt.getTime() < GAP_MS));
        const due = audit.calls.filter((c) => c.status === "PLANNED" && !c.toNumber && c.scheduledAt.getTime() <= now);
        for (const c of due.slice(1)) if (now - c.scheduledAt.getTime() > LATE_LIMIT_MS) await rescheduleOrSkip(c);
        const next = due[0];
        if (next && now - next.scheduledAt.getTime() > LATE_LIMIT_MS) await rescheduleOrSkip(next);
        else if (next && !busy) {
          await startAuditCall(next.id);
          out.started++;
        }
      }
      if (elevenLabsConfigured()) {
        const agentId = await getSetting("audit.agentId");
        if (agentId) await collectTranscripts(audit, agentId);
      }
      const fresh = await db.callAudit.findUniqueOrThrow({ where: { id: audit.id }, include: { calls: true } });
      await analyzeCalls(fresh, budget);
      const open = realCalls(fresh.calls).some((c) => c.status === "PLANNED" || c.status === "CALLING");
      const transcriptsPending = realCalls(fresh.calls).some((c) => c.status === "ANSWERED" && !c.analysis && !c.note && c.calledAt && now - c.calledAt.getTime() < 3_600_000);
      if (!open && fresh.status === "RUNNING") await db.callAudit.update({ where: { id: audit.id }, data: { status: "ANALYZING" } });
      if (!open && !transcriptsPending) {
        const unanalyzed = (await db.auditCall.count({ where: { auditId: audit.id, toNumber: null, status: "ANSWERED", transcript: { not: "" }, analysis: "" } })) > 0;
        if (!unanalyzed && budget.left > 0) {
          budget.left = 0; // one report per run: it's the slow step
          await writeReport(audit.id).catch(async (err: Error) => {
            await db.callAudit.update({ where: { id: audit.id }, data: { error: `Report failed: ${err.message.slice(0, 300)}` } });
          });
        }
      }
    } catch (err) {
      console.error("audit processing failed", audit.id, err);
      out.errors.push(`${audit.id}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return out;
}

/** processAudits at most every 3 minutes (also called from CRM page loads). */
export async function processAuditsThrottled() {
  const last = Number((await getSetting("audit.lastSweep")) ?? 0);
  if (Date.now() - last < 180_000) return;
  await setSetting("audit.lastSweep", String(Date.now()));
  if (!(await db.callAudit.count({ where: { status: { in: ["RUNNING", "ANALYZING"] } } }))) return;
  await processAudits({ analyzeBudget: 2 }).catch((e) => console.error("audit sweep", e));
}

export function parseReport(audit: CallAudit): StoredReport | null {
  return audit.report ? safeJson<StoredReport | null>(audit.report, null) : null;
}
