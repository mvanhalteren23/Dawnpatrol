// Why call this prospect now? (pure; unit tested). Drives the dialer's "reason for the call"
// and its "Best to call now" sort.

export type ReasonInput = {
  fitScore: number | null;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  openTasks: { subject: string | null; dueAt: Date | null }[];
  recent: { type: string; direction: string | null; source: string; occurredAt: Date; subject: string | null; openCount: number; clickCount: number; repliedAt: Date | null; outcome: string | null }[];
};

const DAY = 86400_000;
const daysAgo = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);
const short = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });

const OUTCOME_LABEL: Record<string, string> = {
  no_answer: "no answer",
  voicemail: "left voicemail",
  call_back: "asked for a call back",
  connected: "spoke with them",
  booked: "booked a meeting",
  not_interested: "not interested",
  wrong_number: "wrong number",
};

export function callReasons(a: ReasonInput, now = new Date()): { reasons: string[]; priority: number } {
  const out: { text: string; weight: number }[] = [];

  const due = a.openTasks.filter((t) => t.dueAt && t.dueAt.getTime() <= now.getTime() + DAY).sort((x, y) => x.dueAt!.getTime() - y.dueAt!.getTime());
  if (due[0]) {
    const late = daysAgo(due[0].dueAt!, now);
    out.push({ text: `Task ${late > 0 ? `overdue ${late}d` : "due"}: ${due[0].subject ?? "follow up"}`, weight: 50 + Math.min(late, 10) });
  } else if (a.nextFollowUpAt && a.nextFollowUpAt.getTime() <= now.getTime()) {
    out.push({ text: `Follow-up was due ${short(a.nextFollowUpAt)}`, weight: 35 });
  }

  const reply = a.recent.find((r) => r.direction === "INBOUND" && ["EMAIL", "SMS", "LINKEDIN"].includes(r.type) && daysAgo(r.occurredAt, now) <= 14);
  if (reply) out.push({ text: `Replied by ${reply.type.toLowerCase()} ${daysAgo(reply.occurredAt, now) || "today"}${daysAgo(reply.occurredAt, now) ? "d ago" : ""}`, weight: 45 });

  const demo = a.recent.find((r) => r.source === "demo-line" && daysAgo(r.occurredAt, now) <= 14);
  if (demo) out.push({ text: `Tried the demo line ${short(demo.occurredAt)}`, weight: 40 });

  const engaged = a.recent.find((r) => r.type === "EMAIL" && r.direction === "OUTBOUND" && !r.repliedAt && (r.openCount >= 2 || r.clickCount > 0) && daysAgo(r.occurredAt, now) <= 10);
  if (engaged) out.push({ text: `${engaged.clickCount ? `Clicked a link in` : `Opened ${engaged.openCount}×`} your email${engaged.subject ? ` “${engaged.subject}”` : ""}`, weight: 30 });

  const lastCall = a.recent.find((r) => r.type === "CALL" && r.direction === "OUTBOUND" && r.outcome);
  if (lastCall && OUTCOME_LABEL[lastCall.outcome!]) out.push({ text: `Last call ${short(lastCall.occurredAt)}: ${OUTCOME_LABEL[lastCall.outcome!]}`, weight: lastCall.outcome === "call_back" ? 30 : 5 });

  if (!a.lastContactedAt) out.push({ text: "Never contacted", weight: 15 });
  else if (daysAgo(a.lastContactedAt, now) >= 14) out.push({ text: `No touch in ${daysAgo(a.lastContactedAt, now)} days`, weight: 10 });

  if (a.fitScore != null && a.fitScore >= 70) out.push({ text: `High fit score (${a.fitScore})`, weight: 0 });

  const priority = out.reduce((n, r) => n + r.weight, 0) + (a.fitScore ?? 40) / 4;
  return { reasons: out.sort((x, y) => y.weight - x.weight).slice(0, 3).map((r) => r.text), priority };
}
