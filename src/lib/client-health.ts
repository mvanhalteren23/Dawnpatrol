import "server-only";
import { db } from "./db";
import { periodFor } from "./report-rules";
import { lastLineCheck } from "./line-check";
import { callStats, clientHealth, daysSince, STATUS_ORDER, type CallRow, type CallStats, type Health } from "./client-health-rules";

// CRM → Client health: every live client line with its usage, what's waiting on the owner, the
// daily line check's findings and a status (rules in client-health-rules.ts).

export type ClientRow = Health & {
  receptionistId: string;
  accountId: string;
  account: string;
  agent: string;
  number: string | null;
  liveDays: number;
  stats: CallStats;
  includedMinutes: number;
  bookings30: number;
  openQuestions: number;
  topQuestion: string | null;
  unhandledLeads: number;
  lastCallAt: Date | null;
  lastPortalLoginAt: Date | null;
  hasPortalUser: boolean;
  subscriptionStatus: string | null;
  mrrCents: number;
};

export type HealthBoard = { rows: ClientRow[]; lineCheckAt: string | null; totals: { clients: number; attention: number; watch: number; calls7: number; callsPrev7: number; minutesMonth: number; booked30: number; openQuestions: number; unhandledLeads: number; mrrCents: number } };

/** `ownerId`: only that rep's accounts and unassigned ones (admins pass null for everyone). */
export async function healthBoard(ownerId: string | null, now = new Date()): Promise<HealthBoard> {
  const lines = await db.receptionist.findMany({
    where: { lifecycle: "production", agentType: "inbound", bookingAddsToCrm: false, ...(ownerId ? { account: { OR: [{ ownerId }, { ownerId: null }] } } : {}) },
    select: {
      id: true, name: true, businessName: true, businessNumber: true, timezone: true, createdAt: true, bookingEnabled: true, guardTrippedAt: true,
      account: { select: { id: true, name: true, convertedAt: true, subscription: { select: { status: true, mrrCents: true, plan: { select: { includedMinutes: true } } } }, users: { where: { role: "CLIENT", disabled: false }, select: { lastLoginAt: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const ids = lines.map((l) => l.id);
  if (!ids.length) return { rows: [], lineCheckAt: (await lastLineCheck())?.at ?? null, totals: { clients: 0, attention: 0, watch: 0, calls7: 0, callsPrev7: 0, minutesMonth: 0, booked30: 0, openQuestions: 0, unhandledLeads: 0, mrrCents: 0 } };

  const since = new Date(now.getTime() - 32 * 86_400_000); // covers 30 days and the current month in any time zone
  const [calls, lastCalls, questions, leads, bookings, check] = await Promise.all([
    db.callLog.findMany({ where: { receptionistId: { in: ids }, startedAt: { gte: since } }, select: { receptionistId: true, startedAt: true, durationSec: true, outcome: true } }),
    db.callLog.groupBy({ by: ["receptionistId"], where: { receptionistId: { in: ids }, outcome: { not: "SPAM" } }, _max: { startedAt: true } }),
    db.openQuestion.findMany({ where: { receptionistId: { in: ids }, status: "OPEN", kind: "caller" }, select: { receptionistId: true, question: true, askedCount: true, createdAt: true }, orderBy: { askedCount: "desc" } }),
    db.callLog.findMany({ where: { receptionistId: { in: ids }, followUpNeeded: true, followedUpAt: null, startedAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } }, select: { receptionistId: true, startedAt: true } }),
    db.booking.groupBy({ by: ["receptionistId"], where: { receptionistId: { in: ids }, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) }, status: { not: "CANCELLED" } }, _count: { _all: true } }),
    lastLineCheck(),
  ]);

  const callsBy = new Map<string, CallRow[]>();
  for (const c of calls) (callsBy.get(c.receptionistId) ?? callsBy.set(c.receptionistId, []).get(c.receptionistId)!).push(c);
  const lastBy = new Map(lastCalls.map((c) => [c.receptionistId, c._max.startedAt]));
  const bookedBy = new Map(bookings.map((b) => [b.receptionistId, b._count._all]));
  const checkBy = new Map((check?.lines ?? []).map((l) => [l.id, l]));

  const rows: ClientRow[] = lines.map((l) => {
    const qs = questions.filter((q) => q.receptionistId === l.id);
    const ls = leads.filter((x) => x.receptionistId === l.id);
    const stats = callStats(callsBy.get(l.id) ?? [], now, periodFor("month", 0, l.timezone, now).start);
    const logins = l.account.users.map((u) => u.lastLoginAt).filter((d): d is Date => Boolean(d));
    const lastLogin = logins.length ? new Date(Math.max(...logins.map((d) => d.getTime()))) : null;
    const includedMinutes = l.account.subscription?.plan?.includedMinutes || 200;
    const liveSince = l.account.convertedAt && l.account.convertedAt > l.createdAt ? l.account.convertedAt : l.createdAt;
    const lastCallAt = lastBy.get(l.id) ?? null;
    const health = clientHealth({
      liveDays: daysSince(liveSince, now) ?? 0,
      stats,
      includedMinutes,
      bookingEnabled: l.bookingEnabled,
      lastCallAt,
      lineProblems: checkBy.get(l.id)?.problems ?? [],
      lineWarnings: checkBy.get(l.id)?.warnings ?? [],
      paused: Boolean(l.guardTrippedAt),
      subscriptionStatus: l.account.subscription?.status ?? null,
      openQuestions: qs.length,
      oldestQuestionDays: qs.length ? daysSince(new Date(Math.min(...qs.map((q) => q.createdAt.getTime()))), now) : null,
      unhandledLeads: ls.length,
      oldestLeadDays: ls.length ? daysSince(new Date(Math.min(...ls.map((x) => x.startedAt.getTime()))), now) : null,
      lastPortalLoginDays: daysSince(lastLogin, now),
      hasPortalUser: l.account.users.length > 0,
    }, now);
    return {
      ...health,
      receptionistId: l.id, accountId: l.account.id, account: l.account.name, agent: l.name, number: l.businessNumber,
      liveDays: daysSince(liveSince, now) ?? 0, stats, includedMinutes, bookings30: bookedBy.get(l.id) ?? 0,
      openQuestions: qs.length, topQuestion: qs[0]?.question ?? null, unhandledLeads: ls.length, lastCallAt, lastPortalLoginAt: lastLogin,
      hasPortalUser: l.account.users.length > 0, subscriptionStatus: l.account.subscription?.status ?? null, mrrCents: l.account.subscription?.mrrCents ?? 0,
    };
  });
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.reasons.length - a.reasons.length || a.account.localeCompare(b.account));

  const sum = (f: (r: ClientRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    rows,
    lineCheckAt: check?.at ?? null,
    totals: {
      clients: rows.length, attention: rows.filter((r) => r.status === "attention").length, watch: rows.filter((r) => r.status === "watch").length,
      calls7: sum((r) => r.stats.calls7), callsPrev7: sum((r) => r.stats.callsPrev7), minutesMonth: sum((r) => r.stats.minutesMonth), booked30: sum((r) => Math.max(r.stats.booked30, r.bookings30)),
      openQuestions: sum((r) => r.openQuestions), unhandledLeads: sum((r) => r.unhandledLeads), mrrCents: sum((r) => r.mrrCents),
    },
  };
}
