import { KB_CATEGORIES, KB_CATEGORY_LABELS, type KbCategory } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { activateAllDrafts, deleteKbItem, saveKbItem } from "@/app/kb-actions";
import { Badge, Empty } from "./ui";

type Item = { id: string; category: string; title: string; content: string; tags: string; isActive: boolean; updatedBy: string | null; updatedAt: Date };

function ItemForm({ receptionistId, returnTo, item }: { receptionistId: string; returnTo: string; item?: Item }) {
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
        <input name="tags" defaultValue={item?.tags} placeholder="tags" className="input max-w-xs" />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isActive" defaultChecked={item ? item.isActive : true} /> Active</label>
        <button className="btn-secondary ml-auto">{item ? "Save" : "Add to knowledge base"}</button>
      </div>
    </form>
  );
}

export function KnowledgeBaseEditor({ receptionistId, items, returnTo }: { receptionistId: string; items: Item[]; returnTo: string }) {
  const drafts = items.filter((i) => i.tags.includes("claude-draft")).length;
  return (
    <div className="space-y-4">
      <div className="card"><h2 className="mb-3">Add knowledge</h2><ItemForm receptionistId={receptionistId} returnTo={returnTo} /></div>
      {drafts ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{drafts} items drafted by Claude are waiting for review (inactive until approved).</span>
          <form action={activateAllDrafts.bind(null, receptionistId, returnTo)}><button className="btn-secondary">Approve all drafts</button></form>
        </div>
      ) : null}
      {items.length === 0 ? <Empty>No knowledge yet. Add services, hours, pricing and FAQs — the receptionist only answers from what&apos;s here.</Empty> : null}
      {KB_CATEGORIES.map((cat) => {
        const inCat = items.filter((i) => i.category === cat);
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
                  <div className="mt-3"><ItemForm receptionistId={receptionistId} returnTo={returnTo} item={item} /></div>
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
