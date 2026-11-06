import type { Metadata } from "next";
import { db } from "@/lib/db";
import { companyName } from "@/lib/brand";
import { KB_CATEGORIES, KB_CATEGORY_LABELS, type KbCategory } from "@/lib/constants";
import { openReviewLink } from "@/lib/kb-review";
import { groupForReview, placeholderHint } from "@/lib/kb-review-rules";
import { formatDate } from "@/lib/utils";
import { BrandLogo } from "@/components/site/BrandLogo";
import { reviewAdd, reviewFinish, reviewItem } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review your receptionist's knowledge", robots: { index: false, follow: false } };

type Item = { id: string; category: string; title: string; content: string; tags: string; isActive: boolean };

const label = (c: string) => KB_CATEGORY_LABELS[c as KbCategory] ?? "Other";

// The client's review page: a link sent by the team before a demo or during onboarding.
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ notice?: string; error?: string; finished?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const company = await companyName();
  const link = await openReviewLink(token);
  if (!link) {
    return (
      <Shell company={company}>
        <h1>This link has expired</h1>
        <p className="mt-2 text-slate-600">Review links last 30 days. Ask {company} for a new one, or sign in to your portal if you have one.</p>
      </Shell>
    );
  }
  await db.kbReviewLink.update({ where: { id: link.id }, data: { lastOpenedAt: new Date() } });
  const r = link.receptionist;
  const items = await db.knowledgeItem.findMany({ where: { receptionistId: r.id }, orderBy: [{ category: "asc" }, { title: "asc" }] });
  const groups = groupForReview(items);
  const todo = groups.fill.length + groups.check.length + groups.suggestion.length;

  if (sp.finished) {
    return (
      <Shell company={company}>
        <h1>Thank you!</h1>
        <p className="mt-2 text-slate-600">{r.name} now knows what you&apos;ve shared, and the {company} team has been told. You can come back to this page any time before {formatDate(link.expiresAt)} to make more changes.</p>
        <a href={`/review/${token}`} className="btn mt-6 inline-flex">Back to the review</a>
      </Shell>
    );
  }

  return (
    <Shell company={company}>
      <p className="label">{r.businessName}</p>
      <h1>Help {r.name} answer your calls the way you would.</h1>
      <p className="mt-2 text-slate-600">
        This is everything your AI receptionist knows about {r.businessName}. Fix anything that&apos;s wrong, fill the gaps, and add what&apos;s missing. Each change saves as soon as you press its button. It takes about 10 minutes, and nothing here is shared with your customers word for word: {r.name} uses it to answer their questions.
      </p>
      <p className="mt-1 text-xs text-slate-500">This private link works until {formatDate(link.expiresAt)}. Please don&apos;t share it.</p>
      {sp.notice ? <div className="mt-4 rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{sp.notice}</div> : null}
      {sp.error ? <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{sp.error}</div> : null}
      {todo ? <p className="mt-4 rounded-[10px] bg-dawn-100 px-4 py-2 text-sm text-dawn-700"><b>{todo}</b> thing{todo === 1 ? "" : "s"} need{todo === 1 ? "s" : ""} your answer first, then have a look through the rest.</p> : null}

      <Section title="Please fill in" sub="We couldn't find these. A sentence or two each is plenty." items={groups.fill} token={token} kind="fill" />
      <Section title="Please check: we guessed these" sub="Typical answers for your kind of business. Correct them, or remove any that don't apply." items={groups.check} token={token} kind="check" />
      <Section title="Suggestions from your website" sub="Not used yet. Keep the ones that are right (edit them if needed), and remove the rest." items={groups.suggestion} token={token} kind="suggestion" />
      <Section title={`What ${r.name} knows now`} sub="Open any entry to change or remove it." items={groups.live} token={token} kind="live" />

      <section id="add" className="card mt-8 space-y-3">
        <h2>Add something {r.name} should know</h2>
        <p className="text-sm text-slate-600">Questions customers often ask, services you offer (or don&apos;t), prices you&apos;re happy to quote, who handles what, parking, payment, warranties...</p>
        <form action={reviewAdd.bind(null, token)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Topic<select name="category" defaultValue="FAQ" className="input mt-1">{KB_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></label>
            <label className="text-sm sm:col-span-2">Short title or question<input name="title" maxLength={200} placeholder="e.g. Do you work on weekends?" className="input mt-1" required /></label>
          </div>
          <label className="block text-sm">The answer<textarea name="content" rows={3} maxLength={4000} placeholder="e.g. Saturdays 9 to 2 for emergencies only; we're closed Sundays." className="input mt-1" required /></label>
          <button className="btn">Add</button>
        </form>
      </section>

      <section className="card mt-8 space-y-3">
        <h2>All done?</h2>
        <p className="text-sm text-slate-600">Let us know you&apos;ve finished, and add anything you&apos;d rather tell us than type in above.</p>
        <form action={reviewFinish.bind(null, token)} className="space-y-3">
          <textarea name="note" rows={2} maxLength={2000} placeholder="Optional note for the team" className="input" />
          <button className="btn">I&apos;m done reviewing</button>
        </form>
      </section>
    </Shell>
  );
}

function Shell({ company, children }: { company: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-dawn-50">
      <header className="border-b-4 border-dawn-700 bg-dawn-600 px-4 py-3"><div className="mx-auto max-w-3xl"><BrandLogo /></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="pb-10 text-center text-xs text-slate-500">{company}</footer>
    </div>
  );
}

function Section({ title, sub, items, token, kind }: { title: string; sub: string; items: Item[]; token: string; kind: "fill" | "check" | "suggestion" | "live" }) {
  if (!items.length) return null;
  const open = kind !== "live";
  return (
    <section className="mt-8">
      <h2>{title} <span className="text-base font-normal text-slate-500">({items.length})</span></h2>
      <p className="mb-3 text-sm text-slate-600">{sub}</p>
      <div className="space-y-3">
        {items.map((i) => (
          <details key={i.id} id={i.id} open={open} className={`card p-4 ${kind === "fill" ? "border-dawn-400" : kind === "check" ? "border-amber-300" : ""}`}>
            <summary className="cursor-pointer list-none">
              <span className="text-xs font-semibold uppercase tracking-wide text-dawn-500">{label(i.category)}</span>
              <div className="font-semibold text-dawn-600">{i.title.replace(/\s*\(assumed\)$/i, "")}</div>
              {!open ? <div className="truncate text-sm text-slate-500">{i.content}</div> : null}
            </summary>
            <form action={reviewItem.bind(null, token, i.id)} className="mt-3 space-y-2">
              <input name="title" defaultValue={i.title.replace(/\s*\(assumed\)$/i, "")} maxLength={200} className="input" aria-label="Title" />
              {kind === "fill" ? <p className="text-xs text-slate-500">{placeholderHint(i.content)}</p> : null}
              <textarea name="content" rows={kind === "fill" ? 3 : Math.min(8, Math.max(2, Math.ceil(i.content.length / 90)))} maxLength={4000} defaultValue={kind === "fill" ? "" : i.content} placeholder={kind === "fill" ? "Your answer" : undefined} className="input" aria-label="Answer" />
              <div className="flex flex-wrap gap-2">
                <button name="intent" value="save" className="btn">{kind === "fill" ? "Save answer" : kind === "check" ? "This is right / save" : kind === "suggestion" ? "Keep this" : "Save changes"}</button>
                <button name="intent" value="remove" className="btn-danger" formNoValidate>{kind === "fill" ? "Doesn't apply" : "Remove"}</button>
              </div>
            </form>
          </details>
        ))}
      </div>
    </section>
  );
}
