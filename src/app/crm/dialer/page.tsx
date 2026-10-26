import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PROSPECT_STAGES, STAGE_LABELS, type Stage } from "@/lib/constants";
import { dialerStatus } from "@/lib/dialer";
import { contactName, formatDate } from "@/lib/utils";
import { Notice, PageHeader } from "@/components/ui";
import { Dialer, type DialTarget } from "@/components/Dialer";

export const dynamic = "force-dynamic";

const SORTS: Record<string, { label: string; orderBy: Prisma.AccountOrderByWithRelationInput[] }> = {
  stale: { label: "Last touched: longest ago first", orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }, { fitScore: { sort: "desc", nulls: "last" } }] },
  recent: { label: "Last touched: most recent first", orderBy: [{ lastContactedAt: { sort: "desc", nulls: "last" } }] },
  fit: { label: "Research fit score: highest first", orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { lastContactedAt: { sort: "asc", nulls: "first" } }] },
  followup: { label: "Follow-up due: soonest first", orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }] },
  missed: { label: "Est. missed calls: highest first", orderBy: [{ estMissedCallsPerWeek: { sort: "desc", nulls: "last" } }] },
  newest: { label: "Newest accounts first", orderBy: [{ createdAt: "desc" }] },
};

function ago(d: Date | null): string {
  if (!d) return "never touched";
  const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  return days <= 0 ? "touched today" : `touched ${days}d ago`;
}

export default async function DialerPage({ searchParams }: { searchParams: Promise<{ sort?: string; stage?: string; due?: string; q?: string }> }) {
  const sp = await searchParams;
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "stale";
  const stages = sp.stage && (PROSPECT_STAGES as string[]).includes(sp.stage) ? [sp.stage as Stage] : PROSPECT_STAGES;
  const where: Prisma.AccountWhereInput = {
    stage: { in: stages },
    OR: [{ phone: { not: null } }, { contacts: { some: { phone: { not: null } } } }],
    ...(sp.due === "1" ? { nextFollowUpAt: { lte: new Date() } } : {}),
    ...(sp.q ? { name: { contains: sp.q, mode: "insensitive" as const } } : {}),
  };
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [status, accounts, today] = await Promise.all([
    dialerStatus(),
    db.account.findMany({ where, orderBy: SORTS[sort]!.orderBy, take: 200, include: { contacts: { where: { phone: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } } }),
    db.activity.groupBy({ by: ["outcome"], where: { source: "dialer", type: "CALL", occurredAt: { gte: startOfDay } }, _count: true }),
  ]);

  const targets: DialTarget[] = accounts.map((a) => {
    const c = a.contacts[0];
    const usesContact = !a.phone && c;
    return {
      key: a.id,
      accountId: a.id,
      accountName: a.name,
      contactId: usesContact ? c.id : (c?.id ?? null),
      label: usesContact ? `${contactName(c)}${c.title ? ` (${c.title})` : ""}` : "Main line",
      phone: (usesContact ? c.phone : a.phone)!,
      meta: [STAGE_LABELS[a.stage as Stage], a.fitScore != null ? `fit ${a.fitScore}` : null, ago(a.lastContactedAt), a.nextFollowUpAt ? `follow-up ${formatDate(a.nextFollowUpAt)}` : null, a.city].filter(Boolean).join(" · "),
    };
  });
  const calls = today.reduce((n, t) => n + t._count, 0);
  const connects = today.filter((t) => ["connected", "booked", "call_back", "not_interested"].includes(t.outcome ?? "")).reduce((n, t) => n + t._count, 0);
  const booked = today.find((t) => t.outcome === "booked")?._count ?? 0;

  return (
    <div>
      <PageHeader title="Power dialer" subtitle={`${targets.length} active prospects with a phone number · today: ${calls} calls, ${connects} conversations, ${booked} booked`} />
      {!status.ready ? (
        <Notice kind="error">The dialer isn&apos;t set up yet. Go to <Link href="/crm/settings">Settings → Dialer</Link> and click <b>Set up dialer</b>.</Notice>
      ) : null}
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1"><span className="label">Sort</span>
          <select name="sort" defaultValue={sort} className="input">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="label">Stage</span>
          <select name="stage" defaultValue={sp.stage ?? ""} className="input"><option value="">All active</option>{PROSPECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Business name" className="input" /></label>
        <label className="flex items-center gap-1 pb-2"><input type="checkbox" name="due" value="1" defaultChecked={sp.due === "1"} /> Follow-up due only</label>
        <button className="btn-secondary">Apply</button>
      </form>
      <Dialer targets={targets} title="Call list" emptyText="No active prospects with a phone number match these filters." />
    </div>
  );
}
