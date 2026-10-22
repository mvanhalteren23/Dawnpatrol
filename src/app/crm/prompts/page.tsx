import { db } from "@/lib/db";
import { PROMPT_VARIABLES } from "@/lib/prompts";
import { Badge, Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { deletePrompt, savePrompt } from "../actions";

export const dynamic = "force-dynamic";

function PromptForm({ p }: { p?: { id: string; name: string; kind: string; description: string; template: string; isDefault: boolean } }) {
  return (
    <form action={savePrompt} className="grid gap-3">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name" className="col-span-2"><input name="name" defaultValue={p?.name} className="input" required /></Field>
        <Field label="Type">
          <select name="kind" defaultValue={p?.kind ?? "RESEARCH"} className="input">
            <option value="RESEARCH">Account research</option>
            <option value="PROSPECTING">Prospecting</option>
            <option value="OUTREACH">Outreach email</option>
          </select>
        </Field>
      </div>
      <Field label="Description"><input name="description" defaultValue={p?.description} className="input" /></Field>
      <Field label="Prompt template"><textarea name="template" rows={p ? 8 : 6} defaultValue={p?.template} className="input font-mono text-xs" required /></Field>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={p?.isDefault} /> Default for this type</label>
        <button className="btn">{p ? "Save" : "Create prompt"}</button>
      </div>
    </form>
  );
}

export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const prompts = await db.savedPrompt.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], include: { _count: { select: { runs: true } } } });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Saved prompts" subtitle="Reusable Claude instructions for research, prospecting and outreach. Use {{variables}} to fill in account details." />
      <Flash params={await searchParams} />
      <div className="card mb-6">
        <h2 className="mb-2">Variables</h2>
        <div className="flex flex-wrap gap-2 text-xs">{PROMPT_VARIABLES.map((v) => <span key={v.key} title={v.description}><code className="rounded bg-slate-100 px-1">{`{{${v.key}}}`}</code> <span className="text-slate-500">{v.description}</span></span>)}</div>
      </div>
      <div className="card mb-6"><h2 className="mb-3">New prompt</h2><PromptForm /></div>
      <div className="space-y-4">
        {prompts.map((p) => (
          <details key={p.id} className="card">
            <summary className="flex cursor-pointer items-center justify-between">
              <span className="font-medium">{p.name} <Badge>{p.kind.toLowerCase()}</Badge> {p.isDefault ? <Badge className="bg-dawn-100 text-dawn-700">default</Badge> : null}</span>
              <span className="text-xs text-slate-500">{p._count.runs} runs</span>
            </summary>
            <div className="mt-4"><PromptForm p={p} /></div>
            <form action={deletePrompt.bind(null, p.id)} className="mt-2"><button className="text-xs text-red-600">Delete prompt</button></form>
          </details>
        ))}
      </div>
    </div>
  );
}
