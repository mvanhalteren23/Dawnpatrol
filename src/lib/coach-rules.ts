// Sales coach (pure; unit tested): how calls are counted per script, which script gets credit for
// a closed deal, and what the coach is given to read.

export const COACH_TIMEFRAMES = [7, 14, 30, 90] as const;
/** Calls with a script before the coach reviews it and suggests new approaches. */
export const SCRIPT_REVIEW_MIN_CALLS = 10;
/** The most calls the coach reads in one review (newest first), and how much of each transcript. */
export const MAX_CALLS_IN_REVIEW = 60;
export const TRANSCRIPT_CHARS_PER_CALL = 2500;

/** Outcomes where someone actually talked with us. */
const CONNECTED = new Set(["connected", "booked", "interested", "call_back", "not_interested"]);
const POSITIVE = new Set(["booked", "interested"]);

export type CoachCall = {
  id: string;
  accountId: string;
  accountName: string;
  industry: string | null;
  scriptId: string | null;
  outcome: string | null;
  durationSec: number | null;
  occurredAt: Date;
  body: string | null; // the call's notes, summary and transcript
  rep: string | null;
};

export type ScriptStat = {
  scriptId: string | null; // null = no script chosen
  calls: number;
  connected: number;
  meetings: number; // booked
  interested: number;
  deals: number; // accounts that became clients after this script's call (last script before they signed)
  connectRate: number; // 0-1
  meetingRate: number; // meetings per connected conversation
};

/**
 * Calls, conversations, meetings and closed deals per script. A closed deal is credited to the last
 * script used on that account before it became a client (`convertedAt`).
 */
export function scriptStats(calls: CoachCall[], converted: Map<string, Date>): ScriptStat[] {
  const by = new Map<string | null, ScriptStat>();
  const stat = (id: string | null) => {
    let s = by.get(id);
    if (!s) by.set(id, (s = { scriptId: id, calls: 0, connected: 0, meetings: 0, interested: 0, deals: 0, connectRate: 0, meetingRate: 0 }));
    return s;
  };
  for (const c of calls) {
    const s = stat(c.scriptId);
    s.calls++;
    if (c.outcome && CONNECTED.has(c.outcome)) s.connected++;
    if (c.outcome === "booked") s.meetings++;
    if (c.outcome === "interested") s.interested++;
  }
  // Deal credit: the latest call before conversion, per converted account.
  for (const [accountId, at] of converted) {
    const last = calls.filter((c) => c.accountId === accountId && c.occurredAt <= at).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    if (last) stat(last.scriptId).deals++;
  }
  for (const s of by.values()) {
    s.connectRate = s.calls ? s.connected / s.calls : 0;
    s.meetingRate = s.connected ? s.meetings / s.connected : 0;
  }
  return [...by.values()].sort((a, b) => b.deals - a.deals || b.meetings - a.meetings || b.meetingRate - a.meetingRate || b.calls - a.calls);
}

/** The best performer with enough calls to mean something (at least 5 conversations), or null. */
export function bestScript(stats: ScriptStat[]): ScriptStat | null {
  const eligible = stats.filter((s) => s.scriptId && s.connected >= 5);
  return eligible.sort((a, b) => b.deals - a.deals || b.meetingRate - a.meetingRate || b.meetings - a.meetings)[0] ?? null;
}

/** Only the useful part of a call's notes for the coach: the summary and the transcript, trimmed. */
export function callText(body: string | null): string {
  const b = (body ?? "").trim();
  if (!b) return "";
  const summary = /Summary:\s*([\s\S]*?)(?:\n\n|$)/.exec(b)?.[1]?.trim();
  const transcript = /Transcript:\s*([\s\S]*)$/.exec(b)?.[1]?.trim();
  const parts = [summary ? `Summary: ${summary}` : null, transcript ? `Transcript: ${transcript.slice(0, TRANSCRIPT_CHARS_PER_CALL)}${transcript.length > TRANSCRIPT_CHARS_PER_CALL ? " …" : ""}` : null].filter(Boolean);
  return parts.length ? parts.join("\n") : b.slice(0, 600);
}

/** What the coach reads: one block per call (newest first), with the script name, outcome and length. */
export function coachMaterial(calls: CoachCall[], scriptNames: Map<string, string>): string {
  return calls
    .filter((c) => callText(c.body))
    .slice(0, MAX_CALLS_IN_REVIEW)
    .map((c, i) => {
      const head = [
        `Call ${i + 1}`,
        c.occurredAt.toISOString().slice(0, 10),
        c.accountName + (c.industry ? ` (${c.industry})` : ""),
        `script: ${c.scriptId ? scriptNames.get(c.scriptId) ?? "unknown" : "none"}`,
        `outcome: ${c.outcome ?? "unknown"}`,
        c.durationSec ? `${Math.round(c.durationSec / 60)} min` : null,
        c.rep ? `rep: ${c.rep}` : null,
      ].filter(Boolean).join(" · ");
      return `### ${head}\n${callText(c.body)}`;
    })
    .join("\n\n");
}

/** The stats as a short table for the coach to reason from. */
export function statsTable(stats: ScriptStat[], scriptNames: Map<string, string>): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return stats
    .map((s) => `- ${s.scriptId ? scriptNames.get(s.scriptId) ?? "unknown" : "No script"}: ${s.calls} calls, ${s.connected} conversations (${pct(s.connectRate)}), ${s.meetings} meetings (${pct(s.meetingRate)} of conversations), ${s.interested} interested, ${s.deals} closed deals`)
    .join("\n");
}

/** Has a script had enough calls for the coach to judge it and suggest new approaches? */
export function scriptReviewReady(calls: number): { ready: boolean; remaining: number } {
  return { ready: calls >= SCRIPT_REVIEW_MIN_CALLS, remaining: Math.max(0, SCRIPT_REVIEW_MIN_CALLS - calls) };
}

/** Practice-call prospects to role-play (the coach plays the owner). */
export const PRACTICE_SCENARIOS = [
  { key: "busy-plumber", label: "Busy plumber, on a job site", brief: "You own a 3-truck plumbing company. You answered between jobs, you're impatient, and you think your wife already answers the phone fine." },
  { key: "skeptical-mechanic", label: "Skeptical auto shop owner", brief: "You run a 4-bay auto repair shop. You've been burned by marketing companies before and assume this is another one. You do miss calls when the techs are under cars." },
  { key: "price-salon", label: "Salon owner focused on price", brief: "You own a hair salon with 5 chairs. Your front desk is busy on Saturdays. Your first question is always the price, and you compare everything to a part-time receptionist's wage." },
  { key: "gatekeeper", label: "Office manager (gatekeeper)", brief: "You're the office manager at a roofing company. Your job is to keep sales calls away from the owner. You'll take a message unless given a good reason." },
  { key: "mortgage-broker", label: "Mortgage broker worried about compliance", brief: "You're an independent mortgage broker. You worry an AI would quote rates or mishandle personal information, and you value a personal touch with clients." },
  { key: "interested-contractor", label: "Interested but 'not now' contractor", brief: "You run a renovation company and like the idea, but it's your busy season and you say to call back in a few months." },
] as const;
export type PracticeKey = (typeof PRACTICE_SCENARIOS)[number]["key"];
