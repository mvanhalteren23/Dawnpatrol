import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { parseWeeklyHours } from "./booking";
import { companyName } from "./brand";
import { sendPlainEmail } from "./outreach";
import { periodFor, reportEmail, summarize, type ReportKind } from "./report-rules";
import { appBase } from "./twilio-request";

// Weekly and monthly call reports for clients: totals only, emailed when the client turns them on
// (portal → Your setup → Email reports), and always viewable in the portal.

function hoursOf(r: Pick<Receptionist, "bookingHours">) {
  try {
    return parseWeeklyHours(r.bookingHours);
  } catch {
    return null;
  }
}

/** The report for one period (offset 0 = so far this period, -1 = the last complete one) and the one before it. */
export async function buildReport(r: Receptionist, kind: ReportKind, offset = 0, now = new Date()) {
  const period = periodFor(kind, offset, r.timezone, now);
  const previous = periodFor(kind, offset - 1, r.timezone, now);
  const select = { startedAt: true, outcome: true, durationSec: true, followUpNeeded: true, followedUpAt: true } as const;
  const [account, cur, prev] = await Promise.all([
    db.account.findUnique({ where: { id: r.accountId }, select: { avgJobValueCents: true } }),
    db.callLog.findMany({ where: { receptionistId: r.id, startedAt: { gte: period.start, lt: period.end } }, select }),
    db.callLog.findMany({ where: { receptionistId: r.id, startedAt: { gte: previous.start, lt: previous.end } }, select }),
  ]);
  const opts = { tz: r.timezone, hours: hoursOf(r), avgJobValueCents: account?.avgJobValueCents ?? null };
  return { period, previous, cur: summarize(cur, period, opts), prev: summarize(prev, previous, opts), avgJobValueCents: opts.avgJobValueCents };
}

/** Who gets the emailed report: the addresses set in Settings, else the client's portal logins. */
export async function reportRecipients(r: Pick<Receptionist, "accountId" | "reportEmails">): Promise<string[]> {
  const listed = r.reportEmails.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (listed.length) return Array.from(new Set(listed));
  const users = await db.user.findMany({ where: { accountId: r.accountId, role: "CLIENT", disabled: false }, select: { email: true } });
  return users.map((u) => u.email);
}

export function wantsReport(r: Pick<Receptionist, "reportFrequency">, kind: ReportKind): boolean {
  return r.reportFrequency === "both" || r.reportFrequency === (kind === "week" ? "weekly" : "monthly");
}

/**
 * Email the last complete week's or month's report. Sent once per period (`force` re-sends it,
 * for "send it now" in Settings).
 */
export async function sendReport(r: Receptionist, kind: ReportKind, opts: { force?: boolean; now?: Date } = {}): Promise<{ sent: boolean; to: string[]; reason?: string }> {
  const report = await buildReport(r, kind, -1, opts.now);
  if (!opts.force && (await db.clientReport.findUnique({ where: { receptionistId_periodKey: { receptionistId: r.id, periodKey: report.period.key } } }))) {
    return { sent: false, to: [], reason: "already sent" };
  }
  const to = await reportRecipients(r);
  if (!to.length) return { sent: false, to, reason: "No one to send it to: add an email under Your setup → Email reports" };
  const company = await companyName();
  const email = reportEmail({
    businessName: r.businessName,
    receptionistName: r.name,
    period: report.period,
    cur: report.cur,
    prev: report.prev,
    avgJobValueCents: report.avgJobValueCents,
    portalUrl: `${appBase()}/portal/reports?kind=${kind}&offset=-1`,
    company,
  });
  let error: string | null = null;
  for (const address of to) {
    try {
      await sendPlainEmail({ to: address, subject: email.subject, body: email.body, fromName: company });
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
    }
  }
  await db.clientReport.upsert({
    where: { receptionistId_periodKey: { receptionistId: r.id, periodKey: report.period.key } },
    create: { receptionistId: r.id, periodKey: report.period.key, sentTo: to.join(", "), totals: JSON.stringify(report.cur), error },
    update: { sentTo: to.join(", "), totals: JSON.stringify(report.cur), error },
  });
  return error ? { sent: false, to, reason: error } : { sent: true, to };
}

/**
 * Daily job: for every client receptionist with reports on, send last week's (and last month's)
 * report if it hasn't gone yet. Runs every day so a missed day catches up; reports older than a
 * week past their period aren't sent late.
 */
export async function runScheduledReports(now = new Date()) {
  const rs = await db.receptionist.findMany({ where: { reportFrequency: { not: "" }, demoExtension: null } });
  const results: { receptionist: string; kind: ReportKind; sent: boolean; reason?: string }[] = [];
  for (const r of rs) {
    for (const kind of ["week", "month"] as const) {
      if (!wantsReport(r, kind)) continue;
      const last = periodFor(kind, -1, r.timezone, now);
      if (now.getTime() - last.end.getTime() > 7 * 86_400_000) continue;
      try {
        const res = await sendReport(r, kind, { now });
        if (res.reason !== "already sent") results.push({ receptionist: r.businessName, kind, sent: res.sent, reason: res.reason });
      } catch (err) {
        results.push({ receptionist: r.businessName, kind, sent: false, reason: (err as Error).message });
      }
    }
  }
  return results;
}
