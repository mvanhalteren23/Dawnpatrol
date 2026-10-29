import { KB_CATEGORIES, KB_CATEGORY_LABELS, type KbCategory } from "@/lib/constants";
import { Empty } from "./ui";

type Item = { id: string; category: string; title: string; content: string; isActive: boolean };

/** What the receptionist knows, read-only (clients request changes; the team edits). */
export function KnowledgeBaseView({ items }: { items: Item[] }) {
  const live = items.filter((i) => i.isActive && i.content.trim());
  if (!live.length) return <Empty>Your knowledge base is being set up by our team.</Empty>;
  return (
    <div className="space-y-4">
      {KB_CATEGORIES.map((cat) => {
        const inCat = live.filter((i) => i.category === cat);
        if (!inCat.length) return null;
        return (
          <div key={cat} className="card">
            <h2 className="mb-3">{KB_CATEGORY_LABELS[cat as KbCategory]}</h2>
            <dl className="space-y-3 text-sm">
              {inCat.map((i) => (
                <div key={i.id}>
                  <dt className="font-medium text-slate-900">{i.title}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-600">{i.content}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
