import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Badge, Empty, Field, Notice, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { addSuppressionEntry, removeSuppressionEntry } from "../actions";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = {
  link: "clicked unsubscribe",
  "one-click": "unsubscribe button in their mail app",
  reply: "asked in a reply",
  bounce: "address bounced",
  manual: "added by hand",
};

export default async function UnsubscribesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; q?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const q = (sp.q ?? "").trim().toLowerCase();
  const [entries, total] = await Promise.all([
    db.emailSuppression.findMany({ where: q ? { value: { contains: q } } : {}, orderBy: { createdAt: "desc" }, take: 500 }),
    db.emailSuppression.count(),
  ]);
  return (
    <div>
      <PageHeader title="Do-not-email list" subtitle={<><Link href="/crm/campaigns">Campaigns</Link> · {total} entries</>} />
      <Flash params={sp} />
      <Notice>
        Every campaign email and every sales email sent from the CRM is checked against this list first. People are added automatically when they click unsubscribe, use their mail app&apos;s unsubscribe button,
        reply asking to be removed, or when an address bounces. Entries stay as your record under CASL; only ones added by hand can be removed. Emails your clients&apos; receptionists send their own customers (booking confirmations) aren&apos;t affected.
      </Notice>
      <section className="card mb-6">
        <form action={addSuppressionEntry} className="grid gap-3 md:grid-cols-3">
          <Field label="Email addresses or domains" className="md:col-span-2"><textarea name="values" rows={2} className="input" placeholder={"owner@shop.com, @competitor.com"} /></Field>
          <Field label="Note (optional)"><input name="note" className="input" placeholder="Asked on the phone, 7 Nov" /></Field>
          <div><SubmitButton pendingText="Adding…">Add to the list</SubmitButton></div>
        </form>
      </section>
      <form className="mb-3 flex gap-2"><input name="q" defaultValue={sp.q ?? ""} placeholder="Search" className="input w-64" /><button className="btn-secondary">Search</button></form>
      {entries.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Address or domain</th><th>Why</th><th>Note</th><th>Added</th><th></th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-xs">{e.value}</td>
                <td><Badge>{REASON[e.reason] ?? e.reason}</Badge></td>
                <td className="max-w-sm truncate text-xs text-slate-600">{e.note}</td>
                <td className="whitespace-nowrap text-xs">{formatDate(e.createdAt, true)}</td>
                <td>{e.reason === "manual" ? <form action={removeSuppressionEntry.bind(null, e.id)}><button className="text-xs text-red-700 underline">Remove</button></form> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>{q ? "No matches." : "Nobody on the list yet."}</Empty>}
    </div>
  );
}
