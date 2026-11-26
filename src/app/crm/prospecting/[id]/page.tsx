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
import Link from "next/link";
import type { SkillRunJson } from "@/lib/prospect-pack";

export const dynamic = "force-dynamic";

export default async function ProspectRun({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const run = await db.researchRun.findUnique({ where: { id }, include: { prompt: true } });
  if (!run) notFound();
  const { prospects = [], skill } = safeJson<{ prospects?: Prospect[]; skill?: SkillRunJson["skill"] }>(run.resultJson, {});
  if (skill) return <SkillRun title={run.input.replace(/^Prospecting skill:\s*/, "")} when={run.createdAt} skill={skill} prospects={prospects} flash={await searchParams} />;
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

const STATUS: Record<string, { label: string; cls: string }> = {
  added: { label: "added", cls: "bg-emerald-100 text-emerald-800" },
  exists: { label: "already in CRM", cls: "bg-slate-100 text-slate-700" },
  error: { label: "not added", cls: "bg-red-100 text-red-800" },
};

/** A prospect pack brought in from the Claude skill: what was added, nothing left to choose. */
function SkillRun({ title, when, skill, prospects, flash }: { title: string; when: Date; skill: SkillRunJson["skill"]; prospects: Prospect[]; flash: { notice?: string; error?: string } }) {
  const added = skill.results.filter((r) => r.status === "added").length;
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={`Claude skill: ${title}`} subtitle={`${when.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })} · ${added} added, ${skill.results.length - added} skipped · no API fees`} actions={<Link href="/crm/prospecting/import" className="btn-secondary">Import another</Link>} />
      <Flash params={flash} />
      {skill.problems.length ? <Notice kind="error"><ul className="list-disc pl-5">{skill.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Notice> : null}
      <ul className="space-y-2">
        {skill.results.map((r, i) => {
          const p = prospects[i];
          const st = STATUS[r.status] ?? STATUS.error!;
          return (
            <li key={i} className="card flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                {r.accountId ? <Link href={`/crm/accounts/${r.accountId}`} className="font-semibold">{r.name}</Link> : <span className="font-semibold">{r.name}</span>}
                <div className="text-xs text-slate-500">{[p?.industry, [p?.city, p?.state].filter(Boolean).join(", "), p?.phone].filter(Boolean).join(" · ")}</div>
                {p?.whyFit ? <p className="mt-1 text-sm text-slate-700">{p.whyFit}</p> : null}
                {r.message ? <p className="mt-1 text-xs text-amber-800">{r.message}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p?.fitScore ? <Badge className={p.fitScore >= 75 ? "bg-emerald-100 text-emerald-800" : p.fitScore >= 50 ? "bg-amber-100 text-amber-800" : ""}>fit {p.fitScore}</Badge> : null}
                {r.researched ? <Badge className="bg-sky-100 text-sky-800">researched</Badge> : null}
                <Badge className={st.cls}>{st.label}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
