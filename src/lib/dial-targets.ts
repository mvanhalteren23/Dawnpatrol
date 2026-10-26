import "server-only";
import type { Prisma } from "@prisma/client";
import type { DialTarget } from "@/components/Dialer";
import { callReasons } from "./call-reasons";
import { STAGE_LABELS, type Stage } from "./constants";
import { contactName, formatDate, formatMoney, safeJson } from "./utils";

// Turn accounts into dialer rows: numbers to pick from, details, why to call now, recent touches
// and research highlights. Shared by the power dialer and the account page.

export const dialAccountInclude = {
  contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
  activities: { where: { type: { notIn: ["STAGE_CHANGE"] } }, orderBy: { occurredAt: "desc" }, take: 25 },
  research: { where: { kind: "RESEARCH", status: "DONE" }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.AccountInclude;

export type DialAccount = Prisma.AccountGetPayload<{ include: typeof dialAccountInclude }>;

const TOUCH_LABEL: Record<string, string> = { EMAIL: "Email", CALL: "Call", SMS: "Text", LINKEDIN: "LinkedIn", MEETING: "Meeting", NOTE: "Note", TASK: "Task", RESEARCH: "Research", BILLING: "Billing" };

function ago(d: Date | null): string {
  if (!d) return "never touched";
  const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  return days <= 0 ? "touched today" : `touched ${days}d ago`;
}

export function toDialTarget(a: DialAccount, now = new Date()): DialTarget & { priority: number } {
  const numbers = [
    ...(a.phone ? [{ contactId: a.contacts.find((c) => c.isPrimary)?.id ?? null, label: "Main line", phone: a.phone }] : []),
    ...a.contacts
      .filter((c) => c.phone && c.phone !== a.phone)
      .map((c) => ({ contactId: c.id, label: `${contactName(c)}${c.title ? ` (${c.title})` : ""}`, phone: c.phone! })),
  ];
  const touches = a.activities.filter((x) => x.type !== "TASK" && x.type !== "RESEARCH");
  const openTasks = a.activities.filter((x) => x.type === "TASK" && !x.completedAt);
  const { reasons, priority } = callReasons({ fitScore: a.fitScore, lastContactedAt: a.lastContactedAt, nextFollowUpAt: a.nextFollowUpAt, openTasks, recent: touches }, now);

  const counts = (type: string) => touches.filter((x) => x.type === type).length;
  const emails = counts("EMAIL");
  const replies = touches.filter((x) => x.type === "EMAIL" && x.direction === "INBOUND").length;
  const summary = [
    emails ? `${emails} email${emails === 1 ? "" : "s"}${replies ? ` (${replies} repl${replies === 1 ? "y" : "ies"})` : ""}` : null,
    counts("CALL") ? `${counts("CALL")} call${counts("CALL") === 1 ? "" : "s"}` : null,
    counts("SMS") ? `${counts("SMS")} text${counts("SMS") === 1 ? "" : "s"}` : null,
    counts("MEETING") ? `${counts("MEETING")} meeting${counts("MEETING") === 1 ? "" : "s"}` : null,
    counts("NOTE") ? `${counts("NOTE")} note${counts("NOTE") === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  const r = safeJson<{ suggestedOpener?: string; keyFacts?: string[]; painSignals?: string[] }>(a.research[0]?.resultJson, {});
  const facts = [...(r.painSignals ?? []).slice(0, 2), ...(r.keyFacts ?? []).slice(0, 3)].slice(0, 4);

  return {
    key: a.id,
    accountId: a.id,
    accountName: a.name,
    numbers,
    priority,
    reasons,
    meta: [STAGE_LABELS[a.stage as Stage], a.fitScore != null ? `fit ${a.fitScore}` : null, a.industry, ago(a.lastContactedAt), a.city].filter(Boolean).join(" · "),
    details: [
      { label: "Fit score", value: a.fitScore != null ? String(a.fitScore) : "—" },
      { label: "Stage", value: STAGE_LABELS[a.stage as Stage] ?? a.stage },
      { label: "Industry", value: a.industry ?? "—" },
      { label: "Location", value: [a.city, a.state].filter(Boolean).join(", ") || "—" },
      { label: "Employees", value: a.employees != null ? String(a.employees) : "—" },
      { label: "Missed calls / wk (est.)", value: a.estMissedCallsPerWeek != null ? String(a.estMissedCallsPerWeek) : "—" },
      { label: "Avg job value", value: a.avgJobValueCents != null ? formatMoney(a.avgJobValueCents) : "—" },
      { label: "Next follow-up", value: a.nextFollowUpAt ? formatDate(a.nextFollowUpAt) : "—" },
      ...(openTasks.length ? [{ label: "Open tasks", value: openTasks.map((t) => t.subject ?? "task").slice(0, 3).join(", ") }] : []),
    ],
    touchSummary: summary || undefined,
    touches: touches.slice(0, 6).map((x) => ({
      when: formatDate(x.occurredAt),
      text: `${TOUCH_LABEL[x.type] ?? x.type}${x.direction ? ` ${x.direction === "INBOUND" ? "in" : "out"}` : ""}: ${x.subject ?? (x.body ?? "").slice(0, 80)}${x.type === "EMAIL" && x.direction === "OUTBOUND" ? ` (${x.openCount} opens${x.repliedAt ? ", replied" : ""})` : ""}`,
    })),
    research: a.research[0] ? { opener: r.suggestedOpener, facts, link: `/crm/research/${a.research[0].id}` } : undefined,
  };
}
