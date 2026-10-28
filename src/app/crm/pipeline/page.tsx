import Link from "next/link";
import { db } from "@/lib/db";
import { STAGES, STAGE_LABELS } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/ui";
import { setStage } from "../actions";
import { requireStaff } from "@/lib/auth";
import { memberLabel, teamMembers } from "@/lib/team";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

const BOARD = ["PROSPECT", "CONTACTED", "ENGAGED", "DEMO", "PROPOSAL", "ONBOARDING", "ACTIVE", "PAST_DUE"] as const;

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ owner?: string; error?: string }> }) {
  const sp = await searchParams;
  const session = await requireStaff();
  const owner = sp.owner ?? (session.role === "ADMIN" ? "" : "me");
  const ownerId = owner === "me" ? session.sub : owner === "unassigned" ? null : owner || undefined;
  const [accounts, team] = await Promise.all([
    db.account.findMany({
      where: { stage: { in: [...BOARD] }, ...(ownerId !== undefined ? { ownerId } : {}) },
      orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 800,
      include: { subscription: true, owner: { select: { name: true, email: true } } },
    }),
    teamMembers(),
  ]);
  const chips: [string, string][] = [["me", "Mine"], ["", "Everyone"], ["unassigned", "Unassigned"], ...team.filter((u) => u.id !== session.sub).map((u) => [u.id, memberLabel(u)] as [string, string])];
  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Prospecting → paying clients on one board. Use the arrows to move a card." />
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        {chips.map(([k, label]) => (
          <Link key={k || "all"} href={`/crm/pipeline?owner=${k}`} className={`rounded-full border px-3 py-1 hover:no-underline ${owner === k ? "border-dawn-600 bg-dawn-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{label}</Link>
        ))}
      </div>
      <Flash params={sp} />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {BOARD.map((stage, idx) => {
          const cards = accounts.filter((a) => a.stage === stage);
          const mrr = cards.reduce((s, a) => s + (a.subscription?.mrrCents ?? 0), 0);
          return (
            <div key={stage} className="w-64 shrink-0">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-sm font-semibold">{STAGE_LABELS[stage]}</span>
                <span className="text-xs text-slate-500">{cards.length}{mrr ? ` · ${formatMoney(mrr)}` : ""}</span>
              </div>
              <div className="space-y-2">
                {cards.slice(0, 100).map((a) => (
                  <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
                    <Link href={`/crm/accounts/${a.id}`} className="font-medium">{a.name}</Link>
                    <div className="text-xs text-slate-500">{[a.industry, a.city].filter(Boolean).join(" · ") || a.domain}</div>
                    {owner !== "me" ? <div className="text-xs text-slate-400">{a.ownerId === session.sub ? "You" : memberLabel(a.owner)}</div> : null}
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                      <span>{a.fitScore != null ? `fit ${a.fitScore}` : ""}{a.nextFollowUpAt ? ` · f/u ${formatDate(a.nextFollowUpAt)}` : ""}</span>
                      <span className="flex gap-1">
                        {idx > 0 ? <form action={setStage.bind(null, a.id, BOARD[idx - 1]!)}><button title={`Move to ${STAGE_LABELS[BOARD[idx - 1]!]}`} className="rounded px-1 hover:bg-slate-100">←</button></form> : null}
                        {idx < BOARD.length - 1 ? <form action={setStage.bind(null, a.id, BOARD[idx + 1]!)}><button title={`Move to ${STAGE_LABELS[BOARD[idx + 1]!]}`} className="rounded px-1 hover:bg-slate-100">→</button></form> : null}
                        <form action={setStage.bind(null, a.id, "LOST")}><button title="Mark lost" className="rounded px-1 hover:bg-slate-100">✕</button></form>
                      </span>
                    </div>
                  </div>
                ))}
                {cards.length > 100 ? <Link href={`/crm/accounts?stage=${stage}`} className="block text-center text-xs">+{cards.length - 100} more</Link> : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">Not shown: {STAGES.filter((s) => !(BOARD as readonly string[]).includes(s)).map((s) => STAGE_LABELS[s]).join(", ")}.</p>
    </div>
  );
}
