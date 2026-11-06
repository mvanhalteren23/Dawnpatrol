// Head Above Digital's own line (pure; unit tested). Grace answers the demo number; keypad digits
// she hears are checked by the app (never by her prompt): the owner's code opens the demo menu, a
// demo extension opens that demo. In the menu, a demo is picked by extension or by company name.

import { normalizeBusinessName } from "./business-names";

export const DEFAULT_MENU_CODE = "1098";
export const MAX_KEYPAD_TRIES = 4;

export type CallerType = "new" | "prospect" | "client" | "team";

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
