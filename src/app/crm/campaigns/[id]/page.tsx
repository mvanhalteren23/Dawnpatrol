import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { availableSenders, parseCampaignSteps, parseSenders, previewRecipient } from "@/lib/campaigns";
import { MAX_DAILY_PER_INBOX, MAX_STEPS, TEMPLATE_TOKENS, type CampaignStep } from "@/lib/campaign-rules";
import { PROSPECT_STAGES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { Badge, Empty, Field, Notice, PageHeader, Stat } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { addCampaignRecipients, deleteCampaign, removeRecipient, saveCampaign, setCampaignStatus, stopRecipient } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-700",
  SENDING: "bg-sky-100 text-sky-800",
  REPLIED: "bg-emerald-100 text-emerald-800",
  UNSUBSCRIBED: "bg-amber-100 text-amber-800",
  BOUNCED: "bg-red-100 text-red-800",
  SKIPPED: "bg-slate-100 text-slate-500",
  DONE: "bg-slate-200 text-slate-600",
};

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string; status?: string; preview?: string; ai?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await requireAdmin();
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) notFound();
  const [senders, groups, recipients, sentSum] = await Promise.all([
    availableSenders(),
    db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
    db.campaignRecipient.findMany({ where: { campaignId: id, ...(sp.status ? { status: sp.status } : {}) }, orderBy: [{ lastSentAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }], take: 300, include: { account: { select: { name: true, fitScore: true } } } }),
    db.campaignRecipient.aggregate({ where: { campaignId: id }, _sum: { step: true } }),
  ]);
  const chosen = new Set(parseSenders(c.senders));
  const steps = parseCampaignSteps(c.steps);
  const editable: CampaignStep[] = Array.from({ length: MAX_STEPS }, (_, i) => steps[i] ?? { delayDays: i === 0 ? 0 : 3, subject: "", body: "" });
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const total = groups.reduce((a, g) => a + g._count._all, 0);
  const senderLabel = new Map(senders.map((s) => [s.key, s.email]));

  const previewId = sp.preview || recipients[0]?.id;
  const preview = previewId ? await previewRecipient(previewId, sp.ai === "1").catch(() => null) : null;

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={<><Link href="/crm/campaigns">Campaigns</Link> · <Badge>{c.status.toLowerCase()}</Badge></>}
        actions={<>
          {c.status !== "ACTIVE" && c.status !== "DONE" ? <form action={setCampaignStatus.bind(null, id, "ACTIVE")}><SubmitButton pendingText="Starting…">{c.status === "PAUSED" ? "Resume" : "Start sending"}</SubmitButton></form> : null}
          {c.status === "ACTIVE" ? <form action={setCampaignStatus.bind(null, id, "PAUSED")}><SubmitButton className="btn-secondary" pendingText="Pausing…">Pause</SubmitButton></form> : null}
          {c.status !== "DONE" && c.status !== "DRAFT" ? <form action={setCampaignStatus.bind(null, id, "DONE")}><SubmitButton className="btn-secondary" pendingText="Finishing…">Finish</SubmitButton></form> : null}
          {c.status === "DRAFT" ? <form action={deleteCampaign.bind(null, id)}><SubmitButton className="btn-secondary text-red-700" pendingText="Deleting…">Delete</SubmitButton></form> : null}
        </>}
      />
      <Flash params={sp} />
      {c.lastError ? <Notice kind="error">{c.lastError}</Notice> : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Recipients" value={total} sub={`${n("QUEUED")} not emailed yet`} />
        <Stat label="Emails sent" value={sentSum._sum.step ?? 0} sub={`${n("SENDING")} mid-sequence`} />
        <Stat label="Replied" value={n("REPLIED")} sub={total ? `${Math.round((n("REPLIED") / total) * 100)}%` : undefined} />
        <Stat label="Unsubscribed" value={n("UNSUBSCRIBED")} />
        <Stat label="Bounced" value={n("BOUNCED")} sub={total && n("BOUNCED") / total > 0.03 ? "Over 3%: clean the list before sending more" : undefined} />
      </div>

      <form action={saveCampaign.bind(null, id)} className="mb-8 space-y-6">
        <section className="card grid gap-4 md:grid-cols-2">
          <Field label="Campaign name"><input name="name" defaultValue={c.name} className="input" /></Field>
          <Field label={`Emails per inbox per day (max ${MAX_DAILY_PER_INBOX})`}><input name="dailyPerInbox" type="number" min={1} max={MAX_DAILY_PER_INBOX} defaultValue={c.dailyPerInbox} className="input" /></Field>
          <Field label="Send between (their local hours)">
            <div className="flex items-center gap-2">
              <input name="sendStartHour" type="number" min={0} max={23} defaultValue={c.sendStartHour} className="input w-20" /> and
              <input name="sendEndHour" type="number" min={1} max={24} defaultValue={c.sendEndHour} className="input w-20" />
              <input name="timezone" defaultValue={c.timezone} className="input" aria-label="Time zone" />
            </div>
          </Field>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="weekdaysOnly" defaultChecked={c.weekdaysOnly} /> Weekdays only</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="buildDemoOnReply" defaultChecked={c.buildDemoOnReply} /> When someone replies, build their demo agent automatically</label>
            <label className="flex items-center gap-2">Build demos <b>before</b> the first email for fit score ≥ <input name="prebuildMinFit" type="number" min={0} max={100} defaultValue={c.prebuildMinFit ?? ""} placeholder="off" className="input w-20" /></label>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-sm font-medium">Send from</div>
            {senders.length ? (
              <div className="flex flex-wrap gap-3 text-sm">
                {senders.map((s) => <label key={s.key} className="flex items-center gap-2"><input type="checkbox" name="sender" value={s.key} defaultChecked={chosen.has(s.key)} /> {s.email}{s.paused ? " (paused)" : ""}</label>)}
              </div>
            ) : <p className="text-sm text-amber-700">Connect a sending inbox on the <Link href="/crm/campaigns">Campaigns page</Link> first.</p>}
          </div>
        </section>

        <section className="card">
          <h2 className="mb-1 font-semibold">The emails</h2>
          <p className="mb-3 text-sm text-slate-500">
            Plain text, no links or images (better delivery). Fill-ins: {TEMPLATE_TOKENS.map((t) => <code key={t} className="mr-1">{`{{${t}}}`}</code>)}.
            A line whose fill-in is empty (e.g. no personal line found, or no demo built yet for <code>{"{{demo_line}}"}</code>) is left out. Your business name, address and the unsubscribe link are added to the end of every email.
            Leave a follow-up&apos;s subject blank to reply in the same thread.
          </p>
          <div className="space-y-5">
            {editable.map((s, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-sm font-medium">
                  Email {i + 1}
                  {i > 0 ? <label className="flex items-center gap-1 font-normal text-slate-600"><input name={`delay_${i}`} type="number" min={1} max={30} defaultValue={s.delayDays || 3} className="input w-16" /> days after the previous one{i >= steps.length ? " (leave the body blank to skip)" : ""}</label> : <input type="hidden" name="delay_0" value="0" />}
                </div>
                <input name={`subject_${i}`} defaultValue={s.subject} placeholder={i === 0 ? "Subject" : "Subject (blank = same thread)"} className="input mb-2" />
                <textarea name={`body_${i}`} defaultValue={s.body} rows={i === 0 ? 10 : 6} className="input font-mono text-sm" />
              </div>
            ))}
          </div>
        </section>
        <SubmitButton pendingText="Saving…">Save campaign</SubmitButton>
      </form>

      {preview ? (
        <section className="card mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Preview: {preview.recipient.account.name} ({preview.recipient.email})</h2>
            {sp.ai === "1" ? null : <Link href={`/crm/campaigns/${id}?preview=${preview.recipient.id}&ai=1`} className="btn-secondary">Write their personal line (AI)</Link>}
          </div>
          {preview.emails.map((e, i) => (
            <div key={i} className="mb-4">
              <div className="text-xs text-slate-500">{i === 0 ? "First email" : `${e.delayDays} days later`}</div>
              <div className="text-sm font-medium">{e.subject}</div>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm text-slate-800">{e.body}</pre>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Add recipients</h2>
        <p className="mb-3 text-sm text-slate-500">From your accounts: each needs a contact with an email address. Anyone on the do-not-email list or already in a campaign is left out. Only email addresses businesses publish themselves (website, Google profile) or gave you.</p>
        <form action={addCampaignRecipients.bind(null, id)} className="grid gap-3 md:grid-cols-3">
          <Field label="Stages">
            <div className="flex flex-wrap gap-2 text-sm">{PROSPECT_STAGES.slice(0, 3).map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" name="stage" value={s} defaultChecked={s === "PROSPECT"} /> {s.toLowerCase()}</label>)}</div>
          </Field>
          <Field label="Tag contains"><input name="tag" className="input" placeholder="e.g. auto-repair" /></Field>
          <Field label="Industry contains"><input name="industry" className="input" /></Field>
          <Field label="City contains"><input name="city" className="input" /></Field>
          <Field label="Minimum fit score"><input name="minFit" type="number" min={0} max={100} className="input" /></Field>
          <Field label="At most"><input name="limit" type="number" min={1} max={1000} defaultValue={100} className="input" /></Field>
          <div className="md:col-span-3"><SubmitButton pendingText="Adding…">Add matching accounts</SubmitButton></div>
        </form>
      </section>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Recipients</span>
        <Link href={`/crm/campaigns/${id}`} className={!sp.status ? "font-medium" : "text-slate-500"}>all</Link>
        {Object.keys(STATUS_CLASS).map((s) => <Link key={s} href={`/crm/campaigns/${id}?status=${s}`} className={sp.status === s ? "font-medium" : "text-slate-500"}>{s.toLowerCase()} ({n(s)})</Link>)}
      </div>
      {recipients.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Business</th><th>Email</th><th>Status</th><th>Sent</th><th>Next email</th><th>From</th><th>Notes</th><th></th></tr></thead>
            <tbody>{recipients.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link>{r.account.fitScore != null ? <span className="ml-1 text-xs text-slate-500">fit {r.account.fitScore}</span> : null}</td>
                <td className="text-xs">{r.email}</td>
                <td><Badge className={STATUS_CLASS[r.status]}>{r.status.toLowerCase()}</Badge></td>
                <td>{r.step}/{steps.length}</td>
                <td className="whitespace-nowrap text-xs">{r.nextSendAt ? formatDate(r.nextSendAt, true) : r.status === "QUEUED" ? "next run" : "—"}</td>
                <td className="text-xs">{r.sender ? senderLabel.get(r.sender) ?? "removed inbox" : ""}</td>
                <td className="max-w-xs text-xs text-slate-600">{r.note}{r.personalLine ? <div className="italic text-slate-500">“{r.personalLine}”</div> : null}</td>
                <td className="whitespace-nowrap text-xs">
                  <Link href={`/crm/campaigns/${id}?preview=${r.id}`}>Preview</Link>
                  {r.step === 0 && r.status === "QUEUED" ? <form action={removeRecipient.bind(null, id, r.id)} className="inline"> · <button className="text-red-700 underline">Remove</button></form> : null}
                  {r.step > 0 && (r.status === "SENDING" || r.status === "QUEUED") ? <form action={stopRecipient.bind(null, id, r.id)} className="inline"> · <button className="underline">Stop</button></form> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>No recipients{sp.status ? " with this status" : " yet"}.</Empty>}
    </div>
  );
}
