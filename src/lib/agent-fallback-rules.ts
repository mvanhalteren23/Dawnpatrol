// When the voice agent can't take or keep a call (pure; unit tested).

/** A call handed to the agent that comes back this fast, with the caller still on the line, failed. */
export const AGENT_FAIL_SECONDS = 20;

/**
 * Add a "what next" address to the agent hand-off, so Twilio asks the CRM what to do if the
 * agent's audio stream ends while the caller is still on the line. Left alone if there's no
 * <Connect>, or it already has an action.
 */
export function withAfterAgent(twimlXml: string, actionUrl: string): string {
  const m = /<Connect(\s[^>]*)?>/.exec(twimlXml);
  if (!m || /\saction\s*=/.test(m[1] ?? "")) return twimlXml;
  const safe = actionUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return twimlXml.replace(m[0], `<Connect${m[1] ?? ""} action="${safe}" method="POST">`);
}

/** Did the agent drop the call (rather than finish it)? */
export function agentDropped(startedMs: number, nowMs: number, callStatus: string | undefined): boolean {
  if (callStatus && callStatus !== "in-progress") return false; // the caller has gone: nothing to rescue
  if (!Number.isFinite(startedMs) || startedMs <= 0) return false;
  return nowMs - startedMs < AGENT_FAIL_SECONDS * 1000;
}

/** Numbers on the account that answer through the CRM but have no backup address. */
export function numbersMissingFallback(numbers: { sid: string; voice_url?: string | null; voice_fallback_url?: string | null }[], appBase: string): string[] {
  const base = appBase.replace(/\/$/, "");
  return numbers.filter((n) => (n.voice_url ?? "").startsWith(`${base}/api/voice/`) && n.voice_fallback_url !== `${base}/api/voice/fallback`).map((n) => n.sid);
}
