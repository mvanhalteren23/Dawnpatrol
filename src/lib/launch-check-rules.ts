// Launch check thresholds (pure; unit tested).

export type CheckState = "ok" | "warn" | "todo" | "unknown";

/** Usage credits: fine under 85%, nearly out from there, out at 98% (calls start dropping). */
export function creditState(used: number, limit: number): CheckState {
  if (!(limit > 0)) return "unknown";
  const share = used / limit;
  return share >= 0.98 ? "todo" : share >= 0.85 ? "warn" : "ok";
}

/** A prepaid balance: empty is a blocker, under the floor is a warning. */
export function moneyState(amount: number, floor: number): CheckState {
  if (!Number.isFinite(amount)) return "unknown";
  return amount <= 0.5 ? "todo" : amount < floor ? "warn" : "ok";
}

/** Blockers first, then warnings, then things we couldn't check, then what's fine. */
export function sortChecks<T extends { state: CheckState }>(checks: T[]): T[] {
  const order: Record<CheckState, number> = { todo: 0, warn: 1, unknown: 2, ok: 3 };
  return [...checks].sort((a, b) => order[a.state] - order[b.state]);
}
