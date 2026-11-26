import Link from "next/link";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai";
import { formatDate, safeJson } from "@/lib/utils";
import { Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { runProspecting } from "../actions";

export const dynamic = "force-dynamic";

export default async function ProspectingPage() {
  const [prompts, runs] = await Promise.all([
    db.savedPrompt.findMany({ where: { kind: "PROSPECTING" }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.researchRun.findMany({ where: { kind: "PROSPECTING" }, orderBy: { createdAt: "desc" }, take: 20, include: { prompt: true } }),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Find prospects with Claude" subtitle="Claude searches the web for businesses that match your saved prompt, scores their fit, and you choose which to add." actions={<div className="flex flex-wrap gap-2"><Link href="/crm/prospecting/import" className="btn-secondary">Import from Claude</Link><Link href="/crm/prompts" className="btn-secondary">Manage prompts</Link></div>} />
      <div className="card mb-4 border-dawn-200 bg-dawn-50/40 text-sm">
        <b>No API fees:</b> prospect in your own Claude app with the Head Above prospecting skill (for example &ldquo;find 15 new auto repair shops in North Vancouver&rdquo;). It researches each business and adds them here. <Link href="/crm/settings#claude-skill">Get the skill</Link> · <Link href="/crm/prospecting/import">Import a file from it</Link>
      </div>
      {!aiConfigured() ? <Notice kind="error">Set ANTHROPIC_API_KEY to enable prospecting.</Notice> : null}
      <form action={runProspecting} className="card space-y-4">
        <Field label="Saved prompt">
          <select name="promptId" className="input">{prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="">Custom ↓</option></select>
        </Field>
        <Field label="Criteria ({{criteria}})"><input name="criteria" className="input" placeholder="HVAC and plumbing companies in Denver, CO with 2-20 employees" required /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="How many ({{count}})"><input name="count" type="number" min={1} max={50} defaultValue={15} className="input" /></Field>
        </div>
        <details><summary className="cursor-pointer text-xs text-slate-500">Custom prompt</summary><textarea name="customPrompt" rows={4} className="input mt-2" /></details>
        <SubmitButton pendingText="Starting…">Find prospects</SubmitButton>
      </form>

      <div className="card mt-6">
        <h2 className="mb-3">Previous searches</h2>
        <div className="-mx-4 overflow-x-auto px-4"><table className="table"><thead><tr><th>Search</th><th>When</th><th>Status</th><th>Found</th></tr></thead>
          <tbody>{runs.map((r) => {
            const n = safeJson<{ prospects?: unknown[] }>(r.resultJson, {}).prospects?.length;
            return <tr key={r.id}><td><Link href={`/crm/prospecting/${r.id}`}>{r.prompt?.name ?? (r.input.startsWith("Prospecting skill:") ? "Claude skill" : "Custom")}</Link><div className="max-w-md truncate text-xs text-slate-500">{r.input.split("\n")[0]}</div></td><td className="text-xs">{formatDate(r.createdAt, true)}</td><td><StatusBadge status={r.status} /></td><td>{n ?? "—"}</td></tr>;
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
