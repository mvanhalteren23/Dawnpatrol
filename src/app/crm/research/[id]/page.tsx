import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { ResearchSummary } from "@/lib/ai";
import { formatDate, safeJson } from "@/lib/utils";
import { PageHeader, StatusBadge, Notice } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Markdown } from "@/components/Markdown";
import { SubmitButton } from "@/components/SubmitButton";
import { applyResearch, saveRunToDrive } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ResearchRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const run = await db.researchRun.findUnique({ where: { id }, include: { account: true, prompt: true } });
  if (!run) notFound();
  const summary = run.kind === "RESEARCH" ? safeJson<ResearchSummary | null>(run.resultJson, null) : null;

  return (
    <div className="max-w-4xl">
      <AutoRefresh active={run.status === "RUNNING"} />
      <PageHeader
        title={run.prompt?.name ?? (run.kind === "KB_DRAFT" ? "Knowledge base draft" : "Research")}
        subtitle={<span className="flex items-center gap-2"><StatusBadge status={run.status} />{run.account ? <Link href={`/crm/accounts/${run.account.id}`}>{run.account.name}</Link> : null}<span className="text-xs text-slate-400">{formatDate(run.createdAt, true)}{run.model ? ` · ${run.model}` : ""}{run.tokensOut ? ` · ${run.tokensIn}/${run.tokensOut} tokens` : ""}</span></span>}
        actions={run.status === "DONE" && run.kind === "RESEARCH" ? <>
          {run.driveFileUrl ? <a href={run.driveFileUrl} target="_blank" rel="noreferrer" className="btn-secondary">Open Google Doc</a> : <form action={saveRunToDrive.bind(null, run.id)}><SubmitButton className="btn-secondary">Save to Drive</SubmitButton></form>}
          {summary ? <form action={applyResearch.bind(null, run.id)}><SubmitButton className="btn">Overwrite account fields</SubmitButton></form> : null}
        </> : null}
      />
      <Flash params={await searchParams} />
      {run.status === "RUNNING" ? <Notice>Claude is searching the web and reading sites. This usually takes 1–4 minutes; the page refreshes itself.</Notice> : null}
      {run.status === "FAILED" ? <Notice kind="error">{run.error}</Notice> : null}

      {summary ? (
        <div className="card mb-6 grid gap-4 sm:grid-cols-3">
          <div><div className="label">Fit score</div><div className="text-3xl font-semibold">{summary.fitScore}</div></div>
          <div><div className="label">Missed calls / week</div><div className="text-3xl font-semibold">{summary.estMissedCallsPerWeek ?? "?"}</div></div>
          <div><div className="label">Avg job value</div><div className="text-3xl font-semibold">{summary.avgJobValueUsd != null ? `$${summary.avgJobValueUsd}` : "?"}</div></div>
          <div className="sm:col-span-3"><div className="label">Suggested opener</div><p className="text-sm">{summary.suggestedOpener}</p></div>
          <div className="sm:col-span-3 grid gap-4 sm:grid-cols-2">
            <div><div className="label">Pain signals</div><ul className="list-disc pl-5 text-sm">{summary.painSignals.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
            <div><div className="label">Decision makers</div><ul className="text-sm">{summary.decisionMakers.map((d, i) => <li key={i}>{d.name}{d.title ? ` — ${d.title}` : ""}{d.email ? ` · ${d.email}` : ""}</li>)}</ul></div>
          </div>
        </div>
      ) : null}

      {run.output ? <div className="card"><Markdown text={run.output} /></div> : null}
      <details className="mt-6 text-sm"><summary className="cursor-pointer text-slate-500">Prompt sent</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs">{run.input}</pre></details>
    </div>
  );
}
