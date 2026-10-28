import "server-only";
import { db } from "./db";
import { computeMrr, payingSubscriptions } from "./metrics";
import { STAGE_PROBABILITY, weightedForecastCents } from "./team-rules";

// Team scoreboard: what each person did in a period, what they own, and what it should be worth.

export const CONVERSATION_OUTCOMES = ["connected", "booked", "call_back", "not_interested"];

export type RepRow = {
  id: string | null; // null = unassigned / system
  name: string;
  role: string;
  accounts: number;
  openPipeline: number; // prospect accounts not lost/won
  byStage: Record<string, number>;
  calls: number;
  conversations: number;
  emails: number;
  replies: number;
  meetings: number;
  notes: number;
  openTasks: number;
  overdueTasks: number;
  won: number; // became clients in the period
  mrrCents: number; // paying clients they own
  forecastCents: number; // weighted MRR from their open pipeline
  commitCents: number; // MRR from Demo/Proposal/Onboarding deals (likely to close)
};

/** Expected MRR of a new client: average of current paying clients, else the cheapest active plan. */
export async function expectedDealMrrCents(): Promise<number> {
  const subs = await db.subscription.findMany({ select: { status: true, mrrCents: true } });
  const paying = payingSubscriptions(subs).filter((s) => s.mrrCents > 0);
  if (paying.length) return Math.round(paying.reduce((n, s) => n + s.mrrCents, 0) / paying.length);
  const plan = await db.plan.findFirst({ where: { isActive: true, priceCents: { gt: 0 } }, orderBy: { priceCents: "asc" } });
  return plan?.priceCents ?? 0;
}

export async function teamReport(since: Date) {
  const now = new Date();
  const [users, activity, replies, accounts, tasks, subs, won, dealMrr] = await Promise.all([
    db.user.findMany({ where: { role: { in: ["ADMIN", "REP"] } }, select: { id: true, name: true, email: true, role: true, disabled: true }, orderBy: { createdAt: "asc" } }),
    db.activity.groupBy({ by: ["createdById", "type", "direction", "outcome"], where: { occurredAt: { gte: since }, source: { not: "system" } }, _count: true }),
    db.activity.groupBy({ by: ["createdById"], where: { type: "EMAIL", direction: "OUTBOUND", repliedAt: { gte: since } }, _count: true }),
    db.account.groupBy({ by: ["ownerId", "stage"], _count: true }),
    db.activity.findMany({ where: { type: "TASK", completedAt: null }, select: { dueAt: true, account: { select: { ownerId: true } } } }),
    db.subscription.findMany({ select: { status: true, mrrCents: true, account: { select: { ownerId: true, stage: true } } } }),
    db.account.groupBy({ by: ["ownerId"], where: { convertedAt: { gte: since } }, _count: true }),
    expectedDealMrrCents(),
  ]);
  const paidAccountStages = new Map<string | null, number>(); // ONBOARDING accounts already paying aren't forecast
  for (const s of payingSubscriptions(subs)) if (s.account.stage === "ONBOARDING") paidAccountStages.set(s.account.ownerId, (paidAccountStages.get(s.account.ownerId) ?? 0) + 1);

  const row = (id: string | null, name: string, role: string): RepRow => {
    const mine = <T extends { createdById: string | null }>(xs: T[]) => xs.filter((x) => x.createdById === id);
    const acts = mine(activity);
    const sum = (f: (a: (typeof acts)[number]) => boolean) => acts.filter(f).reduce((n, a) => n + a._count, 0);
    const owned = accounts.filter((a) => a.ownerId === id);
    const byStage = Object.fromEntries(owned.map((a) => [a.stage, a._count]));
    const forecastable = owned.flatMap((a) => Array.from({ length: a._count }, () => ({ stage: a.stage })));
    // Onboarding accounts that already pay count in MRR, not the forecast.
    let paidOnboarding = paidAccountStages.get(id) ?? 0;
    const open = forecastable.filter((a) => !(a.stage === "ONBOARDING" && paidOnboarding-- > 0));
    const myTasks = tasks.filter((t) => t.account.ownerId === id);
    return {
      id,
      name,
      role,
      accounts: owned.reduce((n, a) => n + a._count, 0),
      openPipeline: open.filter((a) => STAGE_PROBABILITY[a.stage] != null && a.stage !== "ONBOARDING").length,
      byStage,
      calls: sum((a) => a.type === "CALL" && a.direction !== "INBOUND"),
      conversations: sum((a) => a.type === "CALL" && CONVERSATION_OUTCOMES.includes(a.outcome ?? "")),
      emails: sum((a) => a.type === "EMAIL" && a.direction === "OUTBOUND"),
      replies: replies.find((r) => r.createdById === id)?._count ?? 0,
      meetings: sum((a) => a.type === "MEETING"),
      notes: sum((a) => a.type === "NOTE"),
      openTasks: myTasks.length,
      overdueTasks: myTasks.filter((t) => t.dueAt && t.dueAt < now).length,
      won: won.find((w) => w.ownerId === id)?._count ?? 0,
      mrrCents: computeMrr(subs.filter((s) => s.account.ownerId === id)),
      forecastCents: weightedForecastCents(open, dealMrr),
      commitCents: open.filter((a) => ["DEMO", "PROPOSAL", "ONBOARDING"].includes(a.stage)).length * dealMrr,
    };
  };

  const rows = users.filter((u) => !u.disabled || accounts.some((a) => a.ownerId === u.id)).map((u) => row(u.id, u.name || u.email, u.disabled ? "no access" : u.role));
  const unassigned = row(null, "Unassigned", "");
  const total = rows.concat(unassigned).reduce<RepRow>(
    (t, r) => ({
      ...t,
      accounts: t.accounts + r.accounts,
      openPipeline: t.openPipeline + r.openPipeline,
      calls: t.calls + r.calls,
      conversations: t.conversations + r.conversations,
      emails: t.emails + r.emails,
      replies: t.replies + r.replies,
      meetings: t.meetings + r.meetings,
      notes: t.notes + r.notes,
      openTasks: t.openTasks + r.openTasks,
      overdueTasks: t.overdueTasks + r.overdueTasks,
      won: t.won + r.won,
      mrrCents: t.mrrCents + r.mrrCents,
      forecastCents: t.forecastCents + r.forecastCents,
      commitCents: t.commitCents + r.commitCents,
      byStage: Object.fromEntries(Object.keys({ ...t.byStage, ...r.byStage }).map((k) => [k, (t.byStage[k] ?? 0) + (r.byStage[k] ?? 0)])),
    }),
    { ...row("__none__", "Team total", ""), accounts: 0, openPipeline: 0, byStage: {}, calls: 0, conversations: 0, emails: 0, replies: 0, meetings: 0, notes: 0, openTasks: 0, overdueTasks: 0, won: 0, mrrCents: 0, forecastCents: 0, commitCents: 0 },
  );
  return { rows, unassigned, total, dealMrr };
}
