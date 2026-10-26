import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PROSPECT_STAGES, STAGE_LABELS, type Stage } from "@/lib/constants";
import { dialerStatus } from "@/lib/dialer";
import { Notice, PageHeader } from "@/components/ui";
import { Dialer, type DialTarget } from "@/components/Dialer";
import { dialAccountInclude, toDialTarget } from "@/lib/dial-targets";

export const dynamic = "force-dynamic";

const SORTS: Record<string, { label: string; orderBy: Prisma.AccountOrderByWithRelationInput[] }> = {
  best: { label: "Best to call now (tasks due, replies, opens…)", orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }] },
  stale: { label: "Last touched: longest ago first", orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }, { fitScore: { sort: "desc", nulls: "last" } }] },
  recent: { label: "Last touched: most recent first", orderBy: [{ lastContactedAt: { sort: "desc", nulls: "last" } }] },
  fit: { label: "Research fit score: highest first", orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { lastContactedAt: { sort: "asc", nulls: "first" } }] },
  followup: { label: "Follow-up due: soonest first", orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }] },
  missed: { label: "Est. missed calls: highest first", orderBy: [{ estMissedCallsPerWeek: { sort: "desc", nulls: "last" } }] },
  newest: { label: "Newest accounts first", orderBy: [{ createdAt: "desc" }] },
};


export default async function DialerPage({ searchParams }: { searchParams: Promise<{ sort?: string; stage?: string; due?: string; q?: string }> }) {
  const sp = await searchParams;
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "best";
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
    db.account.findMany({ where, orderBy: SORTS[sort]!.orderBy, take: 200, include: dialAccountInclude }),
    db.activity.groupBy({ by: ["outcome"], where: { source: "dialer", type: "CALL", occurredAt: { gte: startOfDay } }, _count: true }),
  ]);

  const rows = accounts.map((a) => toDialTarget(a)).filter((t) => t.numbers.length);
  if (sort === "best") rows.sort((x, y) => y.priority - x.priority);
  const targets: DialTarget[] = rows;
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
