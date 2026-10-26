import Link from "next/link";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { STYLE_GUIDE_KEY, STYLE_PROPOSAL_KEY, wasEdited } from "@/lib/email-writer";
import { formatDate, safeJson } from "@/lib/utils";
import { Badge, Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { deletePrompt, discardStyleProposal, proposeStyleGuideAction, savePrompt, saveStyleGuide } from "../../actions";

export const dynamic = "force-dynamic";

const RETURN = "/crm/outreach/writer";

function EmailPromptForm({ p }: { p?: { id: string; name: string; description: string; template: string; isDefault: boolean } }) {
  return (
    <form action={savePrompt} className="grid gap-2">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <input type="hidden" name="kind" value="OUTREACH" />
      <input type="hidden" name="returnTo" value={`${RETURN}#prompts`} />
      <Field label="Name"><input name="name" defaultValue={p?.name} placeholder="e.g. Follow-up after a missed call" className="input" required /></Field>
      <Field label="When to use it"><input name="description" defaultValue={p?.description} className="input" /></Field>
      <Field label="Instructions for the writer">
        <textarea name="template" rows={p ? 6 : 5} defaultValue={p?.template} className="input font-mono text-xs" required
          placeholder={"Write a short (under 100 words) follow-up email to {{contacts}} at {{company}} ({{industry}}, {{location}}).\nAngle: …\nOne clear call to action."} />
      </Field>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={p?.isDefault} /> Default email prompt</label>
        <button className="btn-secondary">{p ? "Save prompt" : "Add prompt"}</button>
      </div>
    </form>
  );
}

export default async function EmailWriterPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const [guide, proposalRaw, prompts, drafts] = await Promise.all([
    getSetting(STYLE_GUIDE_KEY),
    getSetting(STYLE_PROPOSAL_KEY),
    db.savedPrompt.findMany({ where: { kind: "OUTREACH" }, orderBy: { name: "asc" } }),
    db.emailDraft.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { account: { select: { id: true, name: true } } } }),
  ]);
  const proposal = safeJson<{ guide?: string; changes?: string[] } | null>(proposalRaw, null);
  const sentIds = drafts.map((d) => d.sentActivityId).filter((x): x is string => Boolean(x));
  const replied = new Set((await db.activity.findMany({ where: { id: { in: sentIds }, repliedAt: { not: null } }, select: { id: true } })).map((a) => a.id));
  const promptName = Object.fromEntries(prompts.map((p) => [p.id, p.name]));
  const stats = {
    rated: drafts.filter((d) => d.rating != null).length,
    edited: drafts.filter((d) => d.sentBody && wasEdited(d.body, d.sentBody)).length,
    replies: drafts.filter((d) => d.sentActivityId && replied.has(d.sentActivityId)).length,
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Email writer" subtitle="How AI drafts your outreach emails, and what it has learned from you" actions={<Link href="/crm/outreach" className="btn-secondary">Back to Outreach</Link>} />
      <Flash params={sp} />

      <div className="card mb-6 space-y-3">
        <h2>How it learns</h2>
        <p className="text-sm text-slate-600">
          Every draft follows the style guide below and automatically uses your most recent feedback, up to two emails that worked (got a reply or a 👍), and up to two drafts you rewrote before sending, so you don&apos;t have to repeat yourself.
          Every so often, have it fold all of that into the style guide.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge>{drafts.length} recent drafts</Badge><Badge>{stats.rated} rated</Badge><Badge>{stats.edited} edited before sending</Badge><Badge className="bg-emerald-100 text-emerald-800">{stats.replies} got replies</Badge>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2>Style guide</h2>
          <form action={saveStyleGuide} className="space-y-2">
            <textarea name="guide" rows={12} defaultValue={guide ?? ""} className="input text-sm"
              placeholder={"- Under 90 words, plain text, no emojis\n- Open with something specific to their business, never \"I hope this finds you well\"\n- One question as the call to action\n- No hype words: revolutionary, game-changing, leverage"} />
            <div className="flex gap-2">
              <SubmitButton pendingText="Saving…">Save style guide</SubmitButton>
              <SubmitButton formAction={proposeStyleGuideAction} className="btn-secondary" pendingText="Learning…">Suggest updates from feedback</SubmitButton>
            </div>
          </form>
        </div>

        {proposal?.guide ? (
          <div className="card space-y-3 border-amber-300">
            <h2>Proposed update</h2>
            {proposal.changes?.length ? <ul className="list-disc pl-5 text-xs text-slate-600">{proposal.changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
            <form action={saveStyleGuide} className="space-y-2">
              <textarea name="guide" rows={12} defaultValue={proposal.guide} className="input text-sm" />
              <div className="flex gap-2">
                <SubmitButton pendingText="Saving…">Use this style guide</SubmitButton>
                <SubmitButton formAction={discardStyleProposal} className="btn-secondary" pendingText="…">Discard</SubmitButton>
              </div>
            </form>
          </div>
        ) : (
          <div className="card space-y-2 text-sm text-slate-600">
            <h2>Tips for useful feedback</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Be specific: &ldquo;cut the first paragraph&rdquo; beats &ldquo;too long&rdquo;.</li>
              <li>Say what to do, not just what&apos;s wrong: &ldquo;lead with their missed-call estimate&rdquo;.</li>
              <li>Edit drafts freely before sending: the writer compares your edits with its draft.</li>
              <li>Use extra instructions for one-off details; use the style guide for rules that always apply.</li>
            </ul>
          </div>
        )}
      </div>

      <div id="prompts" className="card mb-6 space-y-4">
        <h2>Email prompts</h2>
        <p className="text-xs text-slate-500">One per kind of email (first touch, follow-up, after a demo…). Variables: <code>{"{{company}}"}</code>, <code>{"{{contacts}}"}</code>, <code>{"{{industry}}"}</code>, <code>{"{{location}}"}</code>, <code>{"{{website}}"}</code>, <code>{"{{notes}}"}</code>, <code>{"{{demo_phone}}"}</code>, <code>{"{{demo_extension}}"}</code>, <code>{"{{my_company}}"}</code>.</p>
        {prompts.map((p) => (
          <details key={p.id} className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium">{p.name} {p.isDefault ? <Badge className="bg-dawn-100 text-dawn-700">default</Badge> : null} <span className="font-normal text-slate-500">{p.description}</span></summary>
            <div className="mt-3"><EmailPromptForm p={p} /></div>
            <form action={deletePrompt.bind(null, p.id)} className="mt-2"><button className="text-xs text-red-600">Delete prompt</button></form>
          </details>
        ))}
        <div className="rounded-lg border border-dashed border-slate-300 p-3">
          <div className="mb-2 text-sm font-medium">New email prompt</div>
          <EmailPromptForm />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3">Recent drafts and feedback</h2>
        {drafts.length ? (
          <table className="table text-sm">
            <thead><tr><th>When</th><th>Account</th><th>Prompt</th><th>Rating</th><th>Feedback</th><th>Sent</th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap text-xs">{formatDate(d.createdAt, true)}</td>
                  <td><Link href={`/crm/accounts/${d.account.id}?draft=${d.id}`}>{d.account.name}</Link></td>
                  <td className="text-xs">{d.promptId ? promptName[d.promptId] ?? "—" : "—"}</td>
                  <td>{d.rating === 1 ? "👍" : d.rating === -1 ? "👎" : ""}</td>
                  <td className="max-w-xs text-xs">{d.feedback ?? ""}</td>
                  <td className="text-xs">{d.sentBody ? (d.sentActivityId && replied.has(d.sentActivityId) ? <Badge className="bg-emerald-100 text-emerald-800">replied</Badge> : wasEdited(d.body, d.sentBody) ? "edited" : "as drafted") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-slate-500">No drafts yet. Draft an email from any account&apos;s Outreach card.</p>}
      </div>
    </div>
  );
}
