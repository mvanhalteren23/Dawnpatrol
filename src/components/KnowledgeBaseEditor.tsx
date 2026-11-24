import { KB_CATEGORIES, KB_CATEGORY_LABELS, type KbCategory } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { deleteKbItem, reviewDrafts, saveKbItem } from "@/app/kb-actions";
import { isDraft, isGuess, sortDrafts } from "@/lib/draft-review-rules";
import { Badge, Empty } from "./ui";
import { DraftPickAll } from "./DraftPickAll";

type Item = { id: string; category: string; title: string; content: string; tags: string; isActive: boolean; updatedBy: string | null; updatedAt: Date };

function ItemForm({ receptionistId, returnTo, item, client }: { receptionistId: string; returnTo: string; item?: Item; client?: boolean }) {
  return (
    <form action={saveKbItem.bind(null, receptionistId, returnTo)} className="grid gap-2">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="grid grid-cols-3 gap-2">
        <select name="category" defaultValue={item?.category ?? "FAQ"} className="input">
          {KB_CATEGORIES.map((c) => <option key={c} value={c}>{KB_CATEGORY_LABELS[c]}</option>)}
        </select>
        <input name="title" defaultValue={item?.title} placeholder="Title or caller question" className="input col-span-2" required />
      </div>
      <textarea name="content" defaultValue={item?.content} rows={item ? 4 : 3} placeholder="What the receptionist should know or say" className="input" required />
      <div className="flex items-center gap-3">
        {client ? null : <input name="tags" defaultValue={item?.tags} placeholder="tags" className="input max-w-xs" />}
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isActive" defaultChecked={item ? item.isActive : true} /> Active</label>
        <button className="btn-secondary ml-auto">{item ? "Save" : "Add to knowledge base"}</button>
      </div>
    </form>
  );
}

/**
 * Every Claude draft on one screen: read, edit in place, tick, and approve (live within a minute)
 * or discard. Guesses (facts the research didn't find) start unticked so someone reads them first.
 */
function DraftReview({ receptionistId, returnTo, drafts }: { receptionistId: string; returnTo: string; drafts: Item[] }) {
  const guesses = drafts.filter(isGuess).length;
  const formId = `drafts-${receptionistId}`;
  return (
    <form id={formId} action={reviewDrafts.bind(null, receptionistId, returnTo)} className="card space-y-3 border-violet-300 bg-violet-50/40">
      <span id="kb-drafts" className="block scroll-mt-24" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Claude&apos;s drafts to review <span className="text-sm font-normal text-slate-500">({drafts.length})</span></h2>
        <DraftPickAll formId={formId} />
      </div>
      <p className="text-xs text-slate-600">
        {drafts.length - guesses} drafted from the website{guesses ? <>, and <b>{guesses} guess{guesses === 1 ? "" : "es"}</b> (things the research didn&apos;t find; unticked until you check them)</> : null}.
        Edit anything right here, tick what&apos;s right, then approve: approved entries go live within a minute. Discarded ones can be restored under History.
      </p>
      <ul className="space-y-2">
        {drafts.map((d) => {
          const guess = isGuess(d);
          return (
            <li key={d.id} className={`rounded-lg border bg-white p-3 ${guess ? "border-amber-300" : "border-slate-200"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" name="pick" value={d.id} defaultChecked={!guess} className="mt-2 h-5 w-5" aria-label={`Select "${d.title}"`} />
                <div className="grid flex-1 gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select name={`category_${d.id}`} defaultValue={d.category} className="input w-auto py-1 text-xs" aria-label="Category">
                      {KB_CATEGORIES.map((c) => <option key={c} value={c}>{KB_CATEGORY_LABELS[c]}</option>)}
                    </select>
                    {guess ? <Badge className="bg-amber-100 text-amber-900">guess: check it</Badge> : <Badge className="bg-violet-100 text-violet-800">from the website</Badge>}
                    {d.isActive ? <Badge className="bg-emerald-100 text-emerald-800">already live (demo)</Badge> : null}
                  </div>
                  <input name={`title_${d.id}`} defaultValue={d.title.replace(/\s*\(assumed\)\s*$/i, "")} className="input py-1 text-sm font-medium" aria-label="Title" />
                  <textarea name={`content_${d.id}`} defaultValue={d.content} rows={Math.min(6, Math.max(2, Math.ceil(d.content.length / 110)))} className="input text-sm" aria-label="What the receptionist should know" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-violet-200 bg-violet-50/95 py-3">
        <button name="intent" value="approve" className="btn">Approve ticked</button>
        <button name="intent" value="discard" className="btn-secondary">Discard ticked</button>
      </div>
    </form>
  );
}

/** `client`: the client portal, where changes go live straight away and drafts stay with the team. */
export function KnowledgeBaseEditor({ receptionistId, items, returnTo, client = false }: { receptionistId: string; items: Item[]; returnTo: string; client?: boolean }) {
  // Claude's unreviewed drafts are the team's job: reviewed in one panel, and kept out of the lists
  // below until approved. Clients see only what's live or switched off.
  const drafts = sortDrafts(items.filter(isDraft));
  const shown = items.filter((i) => !isDraft(i));
  return (
    <div className="space-y-4">
      {!client && drafts.length ? <DraftReview receptionistId={receptionistId} returnTo={returnTo} drafts={drafts} /> : null}
      <div className="card"><h2 className="mb-3">Add knowledge</h2>{client ? <p className="mb-2 text-xs text-slate-500">Changes go live within a minute. Made a mistake? Undo it under History.</p> : null}<ItemForm receptionistId={receptionistId} returnTo={returnTo} client={client} /></div>
      {shown.length === 0 ? <Empty>No knowledge yet. Add services, hours, pricing and FAQs — the receptionist only answers from what&apos;s here.</Empty> : null}
      {KB_CATEGORIES.map((cat) => {
        const inCat = shown.filter((i) => i.category === cat);
        if (!inCat.length) return null;
        return (
          <div key={cat} className="card">
            <h2 className="mb-3">{KB_CATEGORY_LABELS[cat as KbCategory]} <span className="text-sm font-normal text-slate-400">({inCat.length})</span></h2>
            <div className="space-y-2">
              {inCat.map((item) => (
                <details key={item.id} className={`rounded-lg border p-3 ${item.isActive ? "border-slate-200" : "border-dashed border-amber-300 bg-amber-50/40"}`}>
                  <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{item.title} {!item.isActive ? <Badge className="bg-amber-100 text-amber-800">inactive</Badge> : null}{item.tags.includes("claude-draft") ? <Badge className="bg-violet-100 text-violet-800">claude draft</Badge> : null}</span>
                    <span className="text-xs text-slate-400">{item.updatedBy ?? ""} · {formatDate(item.updatedAt)}</span>
                  </summary>
                  <div className="mt-3"><ItemForm receptionistId={receptionistId} returnTo={returnTo} item={item} client={client} /></div>
                  <form action={deleteKbItem.bind(null, receptionistId, item.id, returnTo)} className="mt-2"><button className="text-xs text-red-600">Delete</button></form>
                </details>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
