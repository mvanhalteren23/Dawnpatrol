// Call protections (pure; unit tested): keep anyone from burning minutes on our lines.
//
// 1. Maximum call length and 2. hang-up on silence: set on every ElevenLabs agent.
// 3. Per-caller limits (rolling 24 hours), stricter for withheld numbers and on the demo line.
// 4. Daily cutoff per line: past its daily minutes, or 3x its usual day, the line takes 2-minute
//    voicemails until someone resets it in the CRM.
// 5. Calls at the same time: extra callers hear a short message and get a text back.
// 6. Outgoing calls only to real Canadian and US numbers, with a daily cap.
// 7. Twilio spending alerts (src/lib/call-guard.ts).
// 8. A block list across every line.

export type LineLimits = { maxConcurrentCalls: number; callerDailyCalls: number; callerDailyMinutes: number };

/** The demo line is on our website, so it's the easiest target: tighter limits. */
export const DEMO_LINE_LIMITS: LineLimits = { maxConcurrentCalls: 2, callerDailyCalls: 3, callerDailyMinutes: 20 };
/** Withheld/anonymous callers share one allowance per line. */
export const ANONYMOUS_DAILY_CALLS = 3;
export const VOICEMAIL_SECONDS = 120;
export const FOLLOWUP_CALLS_PER_AGENT_PER_DAY = 60;
export const FOLLOWUP_CALLS_PER_DAY = 200;

/** Bounds for the per-line settings in the CRM. */
export const GUARD_BOUNDS = {
  maxCallMinutes: [2, 60],
  silenceHangupSeconds: [10, 120],
  callerDailyCalls: [1, 50],
  callerDailyMinutes: [5, 240],
  lineDailyMinutes: [20, 3000],
  maxConcurrentCalls: [1, 20],
} as const;
export type GuardField = keyof typeof GUARD_BOUNDS;

export function clampGuard(field: GuardField, value: number, fallback: number): number {
  const [lo, hi] = GUARD_BOUNDS[field];
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** The demo line uses the stricter of its own settings and the demo defaults. */
export function demoLineLimits(own: Partial<LineLimits> | null): LineLimits {
  return {
    maxConcurrentCalls: Math.min(own?.maxConcurrentCalls ?? Infinity, DEMO_LINE_LIMITS.maxConcurrentCalls),
    callerDailyCalls: Math.min(own?.callerDailyCalls ?? Infinity, DEMO_LINE_LIMITS.callerDailyCalls),
    callerDailyMinutes: Math.min(own?.callerDailyMinutes ?? Infinity, DEMO_LINE_LIMITS.callerDailyMinutes),
  };
}

/** Twilio shows withheld numbers as "anonymous", "Restricted", "+266696687" or nothing. */
export function isAnonymous(from: string | null | undefined): boolean {
  const f = (from ?? "").trim().toLowerCase();
  return !f || /anonymous|restricted|unknown|private|unavailable/.test(f) || f.replace(/\D/g, "") === "266696687" || f.replace(/\D/g, "").length < 7;
}

/** The bucket a caller's calls are counted in. */
export function callerKey(from: string | null | undefined): string {
  return isAnonymous(from) ? "anonymous" : (from ?? "").trim();
}

export type RecentCall = { sid: string; startTime: Date | null; durationSec: number };

/** Is this caller over their allowance for the last 24 hours (not counting this call)? */
export function callerOverLimit(calls: RecentCall[], o: { thisSid: string; limits: LineLimits; anonymous: boolean; now?: Date }): "calls" | "minutes" | null {
  const since = (o.now ?? new Date()).getTime() - 24 * 3600_000;
  const recent = calls.filter((c) => c.sid !== o.thisSid && (!c.startTime || c.startTime.getTime() >= since));
  const maxCalls = o.anonymous ? Math.min(ANONYMOUS_DAILY_CALLS, o.limits.callerDailyCalls) : o.limits.callerDailyCalls;
  if (recent.length >= maxCalls) return "calls";
  const minutes = recent.reduce((n, c) => n + c.durationSec, 0) / 60;
  if (minutes >= o.limits.callerDailyMinutes) return "minutes";
  return null;
}

/**
 * The daily cutoff: trips when the last 24 hours pass the line's limit, or run past 3x its usual
 * day (once there's a usual day worth comparing: 10+ minutes on average, and 30+ minutes today).
 */
export function lineTripReason(o: { last24hMinutes: number; usualDailyMinutes: number; limit: number }): string | null {
  const today = Math.round(o.last24hMinutes);
  if (today > o.limit) return `${today} minutes in the last 24 hours, over the line's limit of ${o.limit}`;
  if (o.usualDailyMinutes >= 10 && today >= 30 && today > 3 * o.usualDailyMinutes) return `${today} minutes in the last 24 hours, more than 3x its usual ${Math.round(o.usualDailyMinutes)} a day`;
  return null;
}

/** NANP area codes outside Canada and the US (Caribbean and Pacific): expensive, and a toll-fraud favourite. */
const NANP_ELSEWHERE = new Set("242 246 264 268 284 340 345 441 473 649 658 664 670 671 684 721 758 767 784 787 809 829 849 868 869 876 939".split(" "));

export function isCanadaOrUs(e164: string): boolean {
  const m = /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(e164);
  return Boolean(m && !NANP_ELSEWHERE.has(m[1]!));
}

/** Twilio Lookup line types we'll place a follow-up call to. */
export function callableLineType(type: string | null | undefined): boolean {
  if (!type) return true; // lookup unavailable: the area-code check still applies
  return ["mobile", "landline", "fixedVoip", "nonFixedVoip", "tollFree"].includes(type);
}

/** The ElevenLabs settings for 1 and 2. */
export function conversationLimits(o: { maxCallMinutes?: number | null; silenceHangupSeconds?: number | null }) {
  return {
    conversation: { max_duration_seconds: clampGuard("maxCallMinutes", o.maxCallMinutes ?? 10, 10) * 60 },
    turn: { silence_end_call_timeout: clampGuard("silenceHangupSeconds", o.silenceHangupSeconds ?? 30, 30) },
  };
}

export const MESSAGES = {
  overLimit: (business: string) => `Thanks for calling ${business}. We've got your earlier calls and passed your message on, so someone will be in touch soon. Goodbye.`,
  busy: (business: string, texting: boolean) => `Thanks for calling ${business}. All our lines are busy right now.${texting ? " We'll send you a text so we can get back to you." : " Please try again in a few minutes."} Goodbye.`,
  busyText: (business: string) => `Sorry we couldn't take your call just now at ${business}. Reply here with what you need and we'll get back to you, or call again in a few minutes.`,
  voicemail: (business: string) => `Thanks for calling ${business}. Please leave your name, number and what you need after the tone, and we'll call you back.`,
};
