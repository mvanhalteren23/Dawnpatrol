// Head Above Digital's own line (pure; unit tested). Grace answers the demo number; keypad digits
// she hears are checked by the app (never by her prompt): the owner's code opens the demo menu, a
// demo extension opens that demo. In the menu, a demo is picked by extension or by company name.

import { normalizeBusinessName } from "./business-names";

export const DEFAULT_MENU_CODE = "1098";
export const MAX_KEYPAD_TRIES = 4;

export type CallerType = "new" | "prospect" | "client" | "team";

// --- Prospects with a demo -----------------------------------------------------------------

const firstOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** Grace's opening for a prospect calling from the number we have for them, who has a demo set up. */
export function demoProspectOpening(o: { firstName?: string | null; company: string; receptionist: string; demoBusiness: string }): string {
  const hi = firstOf(o.firstName) ? `Hi ${firstOf(o.firstName)}` : "Hi there";
  return `${hi}, thanks for calling ${o.company}, it's ${o.receptionist}. How can I help? And your demo receptionist for ${o.demoBusiness} is set up, if you'd like to try it.`;
}

/** Grace coming back on when the demo's time ran out (or it couldn't connect). */
export function demoReturnOpening(o: { firstName?: string | null; company: string; receptionist: string; failed?: boolean }): string {
  const name = firstOf(o.firstName) ? `, ${firstOf(o.firstName)}` : "";
  if (o.failed) return `Sorry about that${name}, the demo didn't connect properly. It's ${o.receptionist} from ${o.company}. I can try it again for you, or book a quick call with the team to go through it together. Which would you prefer?`;
  return `Hi again${name}, it's ${o.receptionist} from ${o.company}. That's the end of the demo time. What did you think? I can book a quick call with the team to go over it and get yours set up.`;
}

/** Seconds before the demo's limit that still count as "it ran out of time" (start-up delay, rounding). */
export const DEMO_TIMEOUT_SLACK_SECONDS = 25;
/** A demo stream ending sooner than this, with the caller still there, didn't connect properly. */
export const DEMO_FAILED_SECONDS = 15;

/**
 * Why a demo's audio ended, from when it was connected: "timeout" (it hit its time limit, Grace
 * comes back to book a follow-up), "failed" (it dropped straight away, Grace comes back), or
 * "ended" (the demo or the caller finished: the call ends as usual). A caller who hung up is "ended".
 */
export function demoEndReason(startedMs: number, nowMs: number, maxMinutes: number, callStatus: string | undefined): "timeout" | "failed" | "ended" {
  if (callStatus && callStatus !== "in-progress") return "ended";
  if (!Number.isFinite(startedMs) || startedMs <= 0) return "ended";
  const secs = (nowMs - startedMs) / 1000;
  if (secs < DEMO_FAILED_SECONDS) return "failed";
  return secs >= maxMinutes * 60 - DEMO_TIMEOUT_SLACK_SECONDS ? "timeout" : "ended";
}

/** What Grace is told about a caller she recognises: the kind of caller only, never their history. */
export function callerTypeFor(account: { stage: string } | null, isClientStage: (s: string) => boolean): CallerType {
  if (!account) return "new";
  return isClientStage(account.stage) ? "client" : "prospect";
}

/**
 * Digits keyed so far in this call (Grace may pass them one at a time or all together): keep the
 * last 12, and say what they unlock. The menu code wins; a demo extension only counts as the whole
 * latest entry, so "1098" can't be read as extension "098".
 */
export function keypadResult(o: { previous: string; entered: string; code: string; extensions: string[] }): { digits: string; action: "menu" | "extension" | "none"; extension?: string } {
  const entered = o.entered.replace(/\D/g, "");
  const digits = `${o.previous}${entered}`.slice(-12);
  if (o.code && digits.endsWith(o.code)) return { digits: "", action: "menu" };
  if (entered && o.extensions.includes(entered)) return { digits: "", action: "extension", extension: entered };
  return { digits, action: "none" };
}

/** The demo a spoken company name means: the closest business name, if it's close enough. */
export function matchDemoByName<T extends { businessName: string }>(spoken: string, demos: T[]): T | null {
  const words = (s: string) => new Set(normalizeBusinessName(s).split(" ").filter((w) => w.length > 1));
  const said = words(spoken);
  if (!said.size) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const d of demos) {
    const name = words(d.businessName);
    if (!name.size) continue;
    const shared = [...name].filter((w) => said.has(w)).length;
    const score = shared / name.size;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return bestScore >= 0.5 ? best : null;
}
