import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ACTIVITY_TYPES, STAGES, STAGE_LABELS, isClientStage } from "@/lib/constants";
import { contactName, formatDate, formatMoney, safeJson } from "@/lib/utils";
import { googleConnection } from "@/lib/google";
import { Badge, Empty, Field, PageHeader, StageBadge, StatusBadge, Notice } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import {
  addContact,
  checkoutLink,
  createDriveFolders,
  createReceptionist,
  deleteAccount,
  deleteContact,
  draftEmail,
  exportOutreachLog,
  inviteClientUser,
  logActivity,
  runResearch,
  saveManualBilling,
  sendEmail,
  updateAccount,
} from "../../actions";

export const dynamic = "force-dynamic";

type Search = { notice?: string; error?: string; draft?: string; checkout?: string };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const account = await db.account.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      activities: { orderBy: { occurredAt: "desc" }, take: 100, include: { contact: true } },
      research: { where: { kind: { in: ["RESEARCH", "KB_DRAFT"] } }, orderBy: { createdAt: "desc" }, take: 10, include: { prompt: true } },
      subscription: { include: { plan: true } },
      invoices: { orderBy: { createdAt: "desc" }, take: 12 },
      receptionists: { include: { _count: { select: { knowledge: true, calls: true } } } },
      driveFolders: true,
      users: true,
    },
  });
  if (!account) notFound();

  const [prompts, plans, google, draftRun] = await Promise.all([
    db.savedPrompt.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
    googleConnection(),
    sp.draft ? db.researchRun.findUnique({ where: { id: sp.draft } }) : null,
  ]);
  const draft = safeJson<{ subject?: string; body?: string }>(draftRun?.resultJson, {});
  const researchPrompts = prompts.filter((p) => p.kind === "RESEARCH");
  const outreachPrompts = prompts.filter((p) => p.kind === "OUTREACH");
  const running = account.research.some((r) => r.status === "RUNNING");
  const emailable = account.contacts.filter((c) => c.email);
  const sentEmails = account.activities.filter((a) => a.type === "EMAIL" && a.direction === "OUTBOUND");
  const replyRate = sentEmails.length ? Math.round((sentEmails.filter((a) => a.repliedAt).length / sentEmails.length) * 100) : null;
  const isClient = isClientStage(account.stage);

  return (
    <div>
      <AutoRefresh active={running} />
      <PageHeader
        title={account.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StageBadge stage={account.stage} />{account.website ? <a href={account.website} target="_blank" rel="noreferrer">{account.domain ?? account.website}</a> : null}{account.phone ? <span>· {account.phone}</span> : null}{account.fitScore != null ? <Badge className="bg-dawn-100 text-dawn-700">Fit {account.fitScore}</Badge> : null}<span className="text-xs text-slate-400">source: {account.source}</span></span>}
        actions={<>
          {account.driveFolderUrl ? <a href={account.driveFolderUrl} target="_blank" rel="noreferrer" className="btn-secondary">📁 Drive folder</a> : null}
          <form action={createDriveFolders.bind(null, account.id)}><SubmitButton className="btn-secondary" pendingText="Creating…">{account.driveFolderUrl ? "Sync Drive folders" : "Create Drive folders"}</SubmitButton></form>
          {isClient ? <Link href={`/portal?account=${account.id}`} className="btn-secondary">View portal</Link> : null}
        </>}
      />
      <Flash params={sp} />
      {sp.checkout ? <Notice kind="success">Checkout link: <a href={sp.checkout} target="_blank" rel="noreferrer" className="break-all">{sp.checkout}</a></Notice> : null}
      {!google.connected ? <Notice>Google isn&apos;t connected — Drive folders and Gmail sending are disabled. <Link href="/crm/settings">Connect in Settings</Link>.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* LEFT: details, contacts, billing, receptionist */}
        <div className="space-y-6 lg:col-span-2">
          <form action={updateAccount.bind(null, account.id)} className="card grid grid-cols-2 gap-3">
            <h2 className="col-span-2">Details</h2>
            <Field label="Name" className="col-span-2"><input name="name" defaultValue={account.name} className="input" required /></Field>
            <Field label="Stage">
              <select name="stage" defaultValue={account.stage} className="input">{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
            </Field>
            <Field label="Fit score"><input name="fitScore" type="number" min={0} max={100} defaultValue={account.fitScore ?? ""} className="input" /></Field>
            <Field label="Website"><input name="website" defaultValue={account.website ?? ""} className="input" /></Field>
            <Field label="Phone"><input name="phone" defaultValue={account.phone ?? ""} className="input" /></Field>
            <Field label="Industry"><input name="industry" defaultValue={account.industry ?? ""} className="input" /></Field>
            <Field label="Employees"><input name="employees" type="number" defaultValue={account.employees ?? ""} className="input" /></Field>
            <Field label="City"><input name="city" defaultValue={account.city ?? ""} className="input" /></Field>
            <Field label="State"><input name="state" defaultValue={account.state ?? ""} className="input" /></Field>
            <Field label="Missed calls / week (est.)"><input name="estMissedCallsPerWeek" type="number" defaultValue={account.estMissedCallsPerWeek ?? ""} className="input" /></Field>
            <Field label="Avg job value ($)"><input name="avgJobValue" defaultValue={account.avgJobValueCents != null ? account.avgJobValueCents / 100 : ""} className="input" /></Field>
            <Field label="Next follow-up"><input name="nextFollowUpAt" type="date" defaultValue={account.nextFollowUpAt?.toISOString().slice(0, 10) ?? ""} className="input" /></Field>
            <Field label="Tags"><input name="tags" defaultValue={account.tags} className="input" /></Field>
            <Field label="Notes" className="col-span-2"><textarea name="notes" rows={3} defaultValue={account.notes} className="input" /></Field>
            {account.estMissedCallsPerWeek && account.avgJobValueCents ? (
              <div className="col-span-2 rounded-lg bg-dawn-50 p-3 text-sm text-dawn-700">
                Revenue at risk: ~{formatMoney(account.estMissedCallsPerWeek * account.avgJobValueCents * 4.3 * 0.3)} / month <span className="text-xs">(missed calls × job value × 30% close rate)</span>
              </div>
            ) : null}
            <div className="col-span-2"><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
          </form>

          <div className="card">
            <h2 className="mb-3">Contacts</h2>
            {account.contacts.length ? (
              <ul className="mb-4 divide-y divide-slate-100 text-sm">
                {account.contacts.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 py-2">
                    <div>
                      <div className="font-medium">{contactName(c)} {c.isPrimary ? <Badge>primary</Badge> : null}</div>
                      <div className="text-xs text-slate-500">{[c.title, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                      {c.linkedin ? <a href={c.linkedin} className="text-xs" target="_blank" rel="noreferrer">LinkedIn</a> : null}
                    </div>
                    <form action={deleteContact.bind(null, account.id, c.id)}><button className="text-xs text-slate-400 hover:text-red-600">remove</button></form>
                  </li>
                ))}
              </ul>
            ) : <div className="mb-4"><Empty>No contacts yet — Claude research adds decision makers automatically.</Empty></div>}
            <form action={addContact.bind(null, account.id)} className="grid grid-cols-2 gap-2">
              <input name="firstName" placeholder="First name" className="input" />
              <input name="lastName" placeholder="Last name" className="input" />
              <input name="title" placeholder="Title" className="input" />
              <input name="email" type="email" placeholder="Email" className="input" />
              <input name="phone" placeholder="Phone" className="input" />
              <input name="linkedin" placeholder="LinkedIn URL" className="input" />
              <div className="col-span-2"><button className="btn-secondary">Add contact</button></div>
            </form>
          </div>

          <div className="card">
            <h2 className="mb-3">Billing</h2>
            {account.subscription ? (
              <div className="mb-3 text-sm">
                <div className="flex items-center gap-2"><StatusBadge status={account.subscription.status} /> {account.subscription.plan?.name ?? "No plan"} · {formatMoney(account.subscription.mrrCents)}/mo · {account.subscription.billingMethod}</div>
                {account.subscription.currentPeriodEnd ? <div className="text-xs text-slate-500">Renews {formatDate(account.subscription.currentPeriodEnd)}</div> : null}
              </div>
            ) : <p className="mb-3 text-sm text-slate-500">Not billing yet.</p>}
            {account.invoices.length ? (
              <table className="table mb-3"><tbody>{account.invoices.map((inv) => (
                <tr key={inv.id}><td>{inv.number ?? "—"}</td><td>{formatMoney(inv.amountCents)}</td><td><StatusBadge status={inv.status} /></td><td>{inv.hostedUrl ? <a href={inv.hostedUrl} target="_blank" rel="noreferrer">view</a> : null}</td></tr>
              ))}</tbody></table>
            ) : null}
            {plans.length ? (
              <>
                <form action={checkoutLink.bind(null, account.id)} className="mb-3 flex gap-2">
                  <select name="planId" className="input">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.priceCents)}/mo</option>)}</select>
                  <SubmitButton className="btn-secondary whitespace-nowrap" pendingText="…">Stripe checkout link</SubmitButton>
                </form>
                <details className="text-sm">
                  <summary className="cursor-pointer text-slate-600">Record manual billing (ACH / invoice)</summary>
                  <form action={saveManualBilling.bind(null, account.id)} className="mt-2 grid grid-cols-3 gap-2">
                    <select name="planId" className="input col-span-3"><option value="">No plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    <input name="mrr" placeholder="MRR $" className="input" />
                    <select name="status" className="input"><option>ACTIVE</option><option>TRIALING</option><option>PAST_DUE</option><option>CANCELED</option></select>
                    <button className="btn-secondary">Save</button>
                  </form>
                </details>
              </>
            ) : <p className="text-sm text-slate-500"><Link href="/crm/billing">Create a plan</Link> to start billing.</p>}
          </div>

          <div className="card">
            <h2 className="mb-3">AI receptionist</h2>
            {account.receptionists.map((r) => (
              <Link key={r.id} href={`/crm/receptionists/${r.id}`} className="mb-2 block rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50 hover:no-underline">
                <div className="flex items-center justify-between"><span className="font-medium text-slate-900">{r.name} — {r.businessName}</span><StatusBadge status={r.syncStatus} /></div>
                <div className="text-xs text-slate-500">{r._count.knowledge} KB items · {r._count.calls} calls{r.demoExtension ? ` · demo ext ${r.demoExtension}` : ""}</div>
              </Link>
            ))}
            <form action={createReceptionist.bind(null, account.id)} className="space-y-2">
              <div className="flex gap-2">
                <input name="name" placeholder="Receptionist name (e.g. Ava)" className="input" />
                <button className="btn-secondary whitespace-nowrap">+ Receptionist</button>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="demo" defaultChecked={!isClient} /> Demo for this prospect — give it an extension on the demo line</label>
            </form>
          </div>

          <div className="card">
            <h2 className="mb-3">Client portal access</h2>
            {account.users.length ? <ul className="mb-3 text-sm">{account.users.map((u) => <li key={u.id}>{u.email} <span className="text-xs text-slate-400">last login {formatDate(u.lastLoginAt)}</span></li>)}</ul> : null}
            <form action={inviteClientUser.bind(null, account.id)} className="grid grid-cols-2 gap-2">
              <input name="email" type="email" placeholder="client@business.com" className="input" required />
              <input name="name" placeholder="Name" className="input" />
              <input name="password" type="text" placeholder="Temporary password (8+)" className="input col-span-2" required minLength={8} />
              <div className="col-span-2"><button className="btn-secondary">Create portal login</button></div>
            </form>
          </div>

          <form action={deleteAccount.bind(null, account.id)}><button className="btn-danger">Delete account</button></form>
        </div>

        {/* RIGHT: research, outreach, timeline */}
        <div className="space-y-6 lg:col-span-3">
          <div className="card">
            <h2 className="mb-3">Claude research</h2>
            <form action={runResearch.bind(null, account.id)} className="space-y-2">
              <div className="flex gap-2">
                <select name="promptId" className="input">
                  {researchPrompts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
                  <option value="">Custom prompt ↓</option>
                </select>
                <SubmitButton className="btn whitespace-nowrap" pendingText="Starting…">Run research</SubmitButton>
              </div>
              <details><summary className="cursor-pointer text-xs text-slate-500">Custom prompt (uses {"{{company}}"}, {"{{website}}"}, {"{{location}}"}…)</summary>
                <textarea name="customPrompt" rows={4} className="input mt-2" placeholder="Leave empty to use the selected saved prompt" />
              </details>
            </form>
            {account.research.length ? (
              <ul className="mt-4 divide-y divide-slate-100 text-sm">
                {account.research.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2">
                    <Link href={`/crm/research/${r.id}`}>{r.kind === "KB_DRAFT" ? "Knowledge base draft" : r.prompt?.name ?? "Custom research"}</Link>
                    <span className="flex items-center gap-2 text-xs text-slate-500">{r.driveFileUrl ? <a href={r.driveFileUrl} target="_blank" rel="noreferrer">Doc</a> : null}<StatusBadge status={r.status} />{formatDate(r.createdAt, true)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2>Outreach</h2>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{sentEmails.length} emails sent{replyRate != null ? ` · ${replyRate}% replied` : ""}</span>
                {google.connected ? <form action={exportOutreachLog.bind(null, account.id)}><button className="underline">Write log to Drive</button></form> : null}
              </div>
            </div>
            {emailable.length ? (
              <>
                {outreachPrompts.length ? (
                  <form action={draftEmail.bind(null, account.id)} className="mb-3 flex gap-2">
                    <select name="contactId" className="input">{emailable.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}</select>
                    <select name="promptId" className="input">{outreachPrompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    <SubmitButton className="btn-secondary whitespace-nowrap" pendingText="Drafting…">Draft with Claude</SubmitButton>
                  </form>
                ) : null}
                <form action={sendEmail.bind(null, account.id)} className="space-y-2">
                  <select name="contactId" className="input" defaultValue={draftRun?.input ?? undefined}>{emailable.map((c) => <option key={c.id} value={c.id}>{contactName(c)} &lt;{c.email}&gt;</option>)}</select>
                  <input name="subject" placeholder="Subject" className="input" defaultValue={draft.subject} required />
                  <textarea name="body" rows={draft.body ? 9 : 5} className="input" defaultValue={draft.body} placeholder="Plain text. Links are click-tracked; opens are tracked." required />
                  <SubmitButton pendingText="Sending…">{google.connected ? "Send via Gmail (tracked)" : "Connect Google to send"}</SubmitButton>
                </form>
              </>
            ) : <Empty>Add a contact with an email to send tracked outreach.</Empty>}

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-slate-600">Log a call, SMS, LinkedIn touch, meeting, note or task</summary>
              <form action={logActivity.bind(null, account.id)} className="mt-2 grid grid-cols-2 gap-2">
                <select name="type" className="input" defaultValue="CALL">{ACTIVITY_TYPES.filter((t) => !["STAGE_CHANGE", "RESEARCH", "BILLING"].includes(t)).map((t) => <option key={t}>{t}</option>)}</select>
                <select name="direction" className="input" defaultValue="OUTBOUND"><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option><option value="">n/a</option></select>
                <select name="contactId" className="input"><option value="">No contact</option>{account.contacts.map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}</select>
                <input name="dueAt" type="date" className="input" title="Due date (tasks)" />
                <input name="subject" placeholder="Subject / outcome" className="input col-span-2" />
                <textarea name="body" rows={2} placeholder="Notes" className="input col-span-2" />
                <div className="col-span-2"><button className="btn-secondary">Log</button></div>
              </form>
            </details>
          </div>

          <div className="card">
            <h2 className="mb-3">Timeline</h2>
            {account.activities.length ? (
              <ol className="space-y-3">
                {account.activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{a.type.toLowerCase()}</Badge>
                      {a.direction ? <span className="text-xs text-slate-500">{a.direction.toLowerCase()}</span> : null}
                      <span className="text-xs text-slate-400">{formatDate(a.occurredAt, true)} · {a.source}</span>
                      {a.contact ? <span className="text-xs text-slate-500">{contactName(a.contact)}</span> : null}
                      {a.type === "EMAIL" && a.direction === "OUTBOUND" ? <span className="text-xs text-slate-500">👁 {a.openCount} · 🔗 {a.clickCount}{a.repliedAt ? " · ↩ replied" : ""}</span> : null}
                      {a.type === "TASK" ? (a.completedAt ? <Badge className="bg-emerald-100 text-emerald-800">done</Badge> : <span className="text-xs text-amber-700">due {formatDate(a.dueAt)}</span>) : null}
                    </div>
                    {a.subject ? <div className="font-medium">{a.subject}</div> : null}
                    {a.body ? <div className="whitespace-pre-wrap text-xs text-slate-600">{a.body.slice(0, 600)}</div> : null}
                  </li>
                ))}
              </ol>
            ) : <Empty>No touches yet. Outreach from Gmail appears here automatically once Google is connected.</Empty>}
          </div>
        </div>
      </div>
    </div>
  );
}
