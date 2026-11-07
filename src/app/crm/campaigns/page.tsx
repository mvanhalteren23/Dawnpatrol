import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { availableSenders, senderDetails, sentToday } from "@/lib/campaigns";
import { googleConfigured } from "@/lib/google";
import { formatDate } from "@/lib/utils";
import { Badge, Empty, Field, Notice, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { createCampaign, removeInbox, runCampaignsNow, saveSenderDetails, updateInbox } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAUSED: "bg-amber-100 text-amber-800",
  DONE: "bg-slate-200 text-slate-600",
};

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const [campaigns, counts, senders, details, suppressed, inboxes] = await Promise.all([
    db.campaign.findMany({ orderBy: { createdAt: "desc" } }),
    db.campaignRecipient.groupBy({ by: ["campaignId", "status"], _count: { _all: true } }),
    availableSenders(),
    senderDetails(),
    db.emailSuppression.count(),
    db.outreachInbox.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const sentSums = await db.campaignRecipient.groupBy({ by: ["campaignId"], _sum: { step: true } });
  const sentBy = new Map(sentSums.map((s) => [s.campaignId, s._sum.step ?? 0]));
  const count = (id: string, status: string) => counts.find((c) => c.campaignId === id && c.status === status)?._count._all ?? 0;
  const total = (id: string) => counts.filter((c) => c.campaignId === id).reduce((a, c) => a + c._count._all, 0);

  return (
    <div>
      <PageHeader
        title="Email campaigns"
        subtitle="Personal cold email sequences from your sending inboxes, with a demo agent for everyone who replies"
        actions={<>
          <Link href="/crm/campaigns/unsubscribes" className="btn-secondary">Do-not-email list ({suppressed})</Link>
          <form action={runCampaignsNow}><SubmitButton className="btn-secondary" pendingText="Running…">Run a sending pass now</SubmitButton></form>
        </>}
      />
      <Flash params={sp} />
      <Notice>
        Emails go out every 30 minutes during each campaign&apos;s sending hours, a few per inbox at a time, up to its daily limit. Follow-ups reply in the same thread.
        A reply, bounce or unsubscribe stops that person&apos;s sequence; &quot;unsubscribe&quot; and &quot;remove me&quot; replies go on the do-not-email list automatically.
      </Notice>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 font-semibold">Sending inboxes</h2>
          <p className="mb-3 text-sm text-slate-500">Use mailboxes on a separate domain (e.g. tryheadabove.com), warmed up for 2–3 weeks before the first campaign. Your team&apos;s own connected Gmail can send too.</p>
          {senders.length ? (
            <ul className="mb-3 space-y-3">
              {await Promise.all(senders.map(async (s) => {
                const inbox = inboxes.find((i) => `inbox:${i.id}` === s.key);
                const today = await sentToday(s.key, "America/Vancouver");
                return (
                  <li key={s.key} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.email}</span>
                      <Badge>{s.kind === "inbox" ? "campaign inbox" : "team member"}</Badge>
                      {s.paused ? <Badge className="bg-amber-100 text-amber-800">paused</Badge> : null}
                      <span className="text-xs text-slate-500">{today} sent today</span>
                    </div>
                    {s.error ? <div className="mt-1 text-xs text-red-700">{s.error}</div> : null}
                    {inbox ? (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <form action={updateInbox.bind(null, inbox.id)} className="flex flex-wrap items-end gap-2">
                          <label className="text-xs text-slate-600">Name shown to recipients<input name="displayName" defaultValue={inbox.displayName} placeholder="Matt van Halteren" className="input mt-1 w-56" /></label>
                          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="paused" defaultChecked={inbox.paused} /> Paused</label>
                          <SubmitButton className="btn-secondary" pendingText="Saving…">Save</SubmitButton>
                        </form>
                        <form action={removeInbox.bind(null, inbox.id)}><SubmitButton className="btn-secondary text-red-700" pendingText="Removing…">Remove</SubmitButton></form>
                      </div>
                    ) : null}
                  </li>
                );
              }))}
            </ul>
          ) : <Empty>No inboxes yet.</Empty>}
          {googleConfigured() ? <a href="/api/google/auth?for=inbox" className="btn">Connect a sending inbox</a> : <p className="text-sm text-amber-700">Google sign-in isn&apos;t configured (GOOGLE_CLIENT_ID).</p>}
        </section>

        <section className="card">
          <h2 className="mb-1 font-semibold">Who the emails are from (required)</h2>
          <p className="mb-3 text-sm text-slate-500">Canada&apos;s anti-spam law (CASL) needs your business name and a mailing address in every email. They&apos;re added to the bottom with the unsubscribe link.</p>
          <form action={saveSenderDetails} className="space-y-3">
            <Field label="Business name"><input name="legalName" defaultValue={details.legalName} placeholder="Luna VR Inc. (Head Above Digital)" className="input" /></Field>
            <Field label="Mailing address"><input name="address" defaultValue={details.address} placeholder="PO Box 123, Squamish, BC V8B 0A1" className="input" required /></Field>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
          {!details.address ? <p className="mt-2 text-sm text-amber-700">Campaigns can&apos;t start until this is set.</p> : null}
        </section>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Campaigns</h2>
        <form action={createCampaign} className="flex gap-2">
          <input name="name" placeholder="e.g. Sea to Sky auto shops, November" className="input w-72" />
          <SubmitButton pendingText="Creating…">New campaign</SubmitButton>
        </form>
      </div>
      {campaigns.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Campaign</th><th>Status</th><th>Recipients</th><th>Emails sent</th><th>Replied</th><th>Unsubscribed</th><th>Bounced</th><th>Created</th></tr></thead>
            <tbody>{campaigns.map((c) => {
              const n = total(c.id);
              const replied = count(c.id, "REPLIED");
              return (
                <tr key={c.id}>
                  <td><Link href={`/crm/campaigns/${c.id}`} className="font-medium">{c.name}</Link>{c.lastError ? <div className="text-xs text-red-700">{c.lastError}</div> : null}</td>
                  <td><Badge className={STATUS_CLASS[c.status]}>{c.status.toLowerCase()}</Badge></td>
                  <td>{n}</td>
                  <td>{sentBy.get(c.id) ?? 0}</td>
                  <td>{replied}{n ? <span className="text-xs text-slate-500"> ({Math.round((replied / n) * 100)}%)</span> : null}</td>
                  <td>{count(c.id, "UNSUBSCRIBED")}</td>
                  <td>{count(c.id, "BOUNCED")}</td>
                  <td className="text-xs">{formatDate(c.createdAt)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <Empty>No campaigns yet.</Empty>}
    </div>
  );
}
