// Business metrics for the dashboard (pure; unit tested).
import { DEFAULT_CLIENT_GOAL } from "./constants";

export type SubLike = { status: string; mrrCents: number };

export function payingSubscriptions<T extends SubLike>(subs: T[]): T[] {
  return subs.filter((s) => s.status === "ACTIVE" || s.status === "TRIALING" || s.status === "PAST_DUE");
}

export function computeMrr(subs: SubLike[]): number {
  return payingSubscriptions(subs)
    .filter((s) => s.status !== "TRIALING")
    .reduce((sum, s) => sum + s.mrrCents, 0);
}

export function goalProgress(payingClients: number, goal = DEFAULT_CLIENT_GOAL) {
  const pctOfMin = Math.min(100, Math.round((payingClients / goal.min) * 100));
  const pctOfMax = Math.min(100, Math.round((payingClients / goal.max) * 100));
  const remainingToMin = Math.max(0, goal.min - payingClients);
  return { pctOfMin, pctOfMax, remainingToMin, goal };
}

/** How many new clients per month are needed to hit the minimum goal by the target date. */
export function requiredPace(payingClients: number, targetDate: Date, goalMin = DEFAULT_CLIENT_GOAL.min, now = new Date()): number | null {
  const months = (targetDate.getTime() - now.getTime()) / (30.44 * 86400000);
  if (months <= 0) return null;
  return Math.max(0, Math.ceil(((goalMin - payingClients) / months) * 10) / 10);
}

export function conversionRate(won: number, totalWorked: number): number {
  return totalWorked ? Math.round((won / totalWorked) * 1000) / 10 : 0;
}
