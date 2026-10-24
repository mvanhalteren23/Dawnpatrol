import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Prospect } from "@/lib/ai";
import { normalizeDomain, safeJson } from "@/lib/utils";
import { Badge, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Markdown } from "@/components/Markdown";
import { SubmitButton } from "@/components/SubmitButton";
import { addProspects } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ProspectRun({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const run = await db.researchRun.findUnique({ where: { id }, include: { prompt: true } });
  if (!run) notFound();
  const { prospects = [] } = safeJson<{ prospects?: Prospect[] }>(run.resultJson, {});
  const domains = prospects.map((p) => normalizeDomain(p.website)).filter((d): d is string => Boolean(d));
  const existing = new Set((await db.account.findMany({ where: { domain: { in: domains } }, select: { domain: true } })).map((a) => a.domain));

  return (
    <div>
      <AutoRefresh active={run.status === "RUNNING"} />
      <PageHeader title={run.prompt?.name ?? "Prospect search"} subtitle={<span className="flex items-center gap-2"><StatusBadge status={run.status} />{prospects.length} found</span>} />
      <Flash params={await searchParams} />
      {run.status === "RUNNING" ? <Notice>Claude is searching… this takes a few minutes for larger lists. The page refreshes itself.</Notice> : null}
      {run.status === "FAILED" ? <Notice kind="error">{run.error}</Notice> : null}

      {prospects.length ? (
        <form action={addProspects.bind(null, run.id)}>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <input name="tags" placeholder="Tags for added accounts" className="input max-w-xs" />
            <label className="flex items-center gap-1"><input type="checkbox" name="research" /> Run default research on each</label>
            <SubmitButton pendingText="Adding…">Add selected to CRM</SubmitButton>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead><tr><th></th><th>Business</th><th>Fit</th><th>Why</th><th>Contact</th><th>Location</th></tr></thead>
              <tbody>
                {prospects.map((p, i) => {
                  const dup = existing.has(normalizeDomain(p.website));
                  return (
                    <tr key={i} className={dup ? "opacity-50" : ""}>
                      <td><input type="checkbox" name="pick" value={i} defaultChecked={!dup && p.fitScore >= 60} disabled={dup} /></td>
                      <td><div className="font-medium">{p.name}</div><div className="text-xs">{p.website ? <a href={p.website.startsWith("http") ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer">{p.website}</a> : "—"} {p.phone ? `· ${p.phone}` : ""}</div>{dup ? <Badge>already in CRM</Badge> : null}</td>
                      <td><Badge className={p.fitScore >= 75 ? "bg-emerald-100 text-emerald-800" : p.fitScore >= 50 ? "bg-amber-100 text-amber-800" : ""}>{p.fitScore}</Badge></td>
                      <td className="max-w-sm text-xs">{p.whyFit}{p.sourceUrl ? <> <a href={p.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</td>
                      <td className="text-xs">{[p.contactName, p.contactTitle, p.contactEmail].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-xs">{[p.city, p.state].filter(Boolean).join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      ) : null}
      {run.output ? <details className="mt-6"><summary className="cursor-pointer text-sm text-slate-500">Claude&apos;s full research notes</summary><div className="card mt-2"><Markdown text={run.output} /></div></details> : null}
    </div>
  );
}
