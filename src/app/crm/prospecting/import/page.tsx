import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { importPackFromForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportFromClaude({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireStaff();
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Import from Claude" subtitle="Prospects found and researched in your own Claude app with the Head Above prospecting skill. No API fees." actions={<Link href="/crm/prospecting" className="btn-secondary">← Prospecting</Link>} />
      <Flash params={await searchParams} />
      <form action={importPackFromForm} className="card space-y-4">
        <Field label="The .json file Claude gave you">
          <input type="file" name="file" accept=".json,application/json,text/plain" className="block w-full text-sm" />
        </Field>
        <Field label="…or paste the prospect pack">
          <textarea name="pack" rows={8} className="input font-mono text-xs" placeholder='{ "format": "headabove.prospects.v1", "prospects": [ … ] }' />
        </Field>
        <Field label="Extra tags (optional)"><input name="tags" className="input" placeholder="e.g. north-van, nov-push" /></Field>
        <SubmitButton pendingText="Importing…">Add to the CRM</SubmitButton>
        <p className="text-xs text-slate-500">Businesses already in the CRM (same website, phone, or name in the same city) are skipped. Research is filled in only where the write-up backs it up, and contact details it doesn&apos;t show are left out.</p>
      </form>
      <p className="text-sm text-slate-600">Don&apos;t have the skill yet? <Link href="/crm/settings#claude-skill">Settings → Claude prospecting skill</Link>.</p>
    </div>
  );
}
