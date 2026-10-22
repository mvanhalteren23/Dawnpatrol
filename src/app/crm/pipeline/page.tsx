import Link from "next/link";
import { db } from "@/lib/db";
import { STAGES, STAGE_LABELS } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/ui";
import { setStage } from "../actions";

export const dynamic = "force-dynamic";

const BOARD = ["PROSPECT", "CONTACTED", "ENGAGED", "DEMO", "PROPOSAL", "ONBOARDING", "ACTIVE", "PAST_DUE"] as const;

export default async function Pipeline() {
  const accounts = await db.account.findMany({
    where: { stage: { in: [...BOARD] } },
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 800,
    include: { subscription: true },
  });
  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Prospecting → paying clients on one board. Use the arrows to move a card." />
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
