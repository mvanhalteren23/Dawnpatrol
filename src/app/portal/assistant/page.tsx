import Link from "next/link";
import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { formatDate } from "@/lib/utils";
import { companyName } from "@/lib/brand";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { AssistantCard } from "@/components/AssistantCard";
import { KnowledgeBaseEditor } from "@/components/KnowledgeBaseEditor";
import { KbHistory } from "@/components/KbHistory";
import { OpenQuestions } from "@/components/CustomerCare";
import { kbHistory } from "@/lib/kb-history";
import { assistantEnabled } from "@/lib/assistant";
import { houseNumber, houseReceptionist } from "@/lib/house-line";
import { prettyPhone } from "@/lib/assistant-rules";
import { saveMyMobile, undoOwnerChange } from "@/app/customer-actions";
import { saveCheckinSettings } from "@/app/assistant-actions";

export const dynamic = "force-dynamic";

// The Assistant tier, all in one place for the client: questions waiting on them, callers to
// sort, what the assistant knows, routing, their PIN, check-ins, and how to reach it (their own
// line, or through Grace on our number). Lines without the tier see what it adds instead.
export default async function PortalAssistant({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist: r, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const returnTo = `/portal/assistant${q}`;
  const [company, on] = await Promise.all([companyName(), r ? assistantEnabled(r) : Promise.resolve(false)]);

  if (!r || !on) {
    return (
      <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
        <h1 className="mb-2">Your assistant</h1>
        {!r ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
          <div className="card max-w-2xl space-y-2 text-sm">
            <p>The Assistant plan turns your receptionist into an assistant: it learns who your suppliers, sales reps and crew are and puts the right calls through to you, you change hours, prices and services by calling or texting it, and it calls you when callers&apos; questions pile up.</p>
            <p className="text-slate-500">Ask the {company} team about adding it.</p>
          </div>
        )}
      </PortalShell>
    );
  }

  const [questions, items, history, callers, updates, users, grace] = await Promise.all([
    db.openQuestion.findMany({ where: { receptionistId: r.id, status: "OPEN" }, orderBy: [{ kind: "desc" }, { askedCount: "desc" }] }),
    db.knowledgeItem.findMany({ where: { receptionistId: r.id }, orderBy: [{ category: "asc" }, { title: "asc" }] }),
    kbHistory(r.id),
    db.knownCaller.findMany({ where: { receptionistId: r.id, status: { not: "DISMISSED" } }, orderBy: [{ lastCallAt: "desc" }, { createdAt: "desc" }], take: 200 }),
    db.ownerUpdate.findMany({ where: { receptionistId: r.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.user.findMany({ where: { accountId: account.id, disabled: false }, select: { id: true, phone: true } }),
    houseReceptionist(),
  ]);
  const me = users.find((u) => u.id === session.sub);
  const recognised = [r.ringFirstNumber, r.checkinPhone, ...users.map((u) => u.phone)].filter((p): p is string => Boolean(p));
  const graceNumber = houseNumber();
  const pendingCallers = callers.filter((c) => c.status === "PENDING").length;

  return (
    <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">{r.name}, your assistant</h1>
      <p className="mb-6 text-sm text-slate-500">Answer what callers asked, sort new callers, change what {r.name} knows and how calls are handled. Everything here is live within a minute.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {questions.length || pendingCallers ? (
        <p className="mb-4 text-sm font-medium">Waiting on you: {[questions.length ? `${questions.length} question${questions.length === 1 ? "" : "s"}` : "", pendingCallers ? `${pendingCallers} caller${pendingCallers === 1 ? "" : "s"} to sort` : ""].filter(Boolean).join(" and ")}.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <OpenQuestions r={r} questions={questions} returnTo={returnTo} />
          <KnowledgeBaseEditor receptionistId={r.id} items={items} returnTo={returnTo} client />
          <KbHistory receptionistId={r.id} revisions={history} returnTo={returnTo} teamName={`${company} team`} />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="card space-y-3 text-sm">
            <h2>Talk to {r.name}</h2>
            <ul className="space-y-1 text-slate-600">
              {r.businessNumber ? <li>Call or text <b>{prettyPhone(r.businessNumber)}</b> from your own phone.</li> : null}
              {graceNumber ? <li>Or call {grace?.name ?? "Grace"} at <b>{prettyPhone(graceNumber)}</b> and ask to be put through to {r.name}.</li> : null}
            </ul>
            <p className="text-xs text-slate-500">Say or text things like &ldquo;closed next Monday&rdquo;, &ldquo;our diagnostic fee is now $140&rdquo;, &ldquo;put suppliers straight through to me&rdquo; or &ldquo;any messages?&rdquo;. Every change is confirmed by text; reply UNDO to reverse it. Recognised numbers: {recognised.map(prettyPhone).join(", ") || "none yet"}.</p>
            {session.role === "CLIENT" ? (
              <form action={saveMyMobile.bind(null, returnTo)} className="flex gap-2">
                <input name="phone" type="tel" defaultValue={me?.phone ?? ""} placeholder="Your mobile" className="input" aria-label="Your mobile" />
                <button className="btn-secondary whitespace-nowrap">Save mobile</button>
              </form>
            ) : null}
            {updates.length ? (
              <div>
                <div className="label mt-2">Recent changes</div>
                <ul className="space-y-1 text-xs">
                  {updates.map((u) => <li key={u.id} className={u.undoneAt ? "text-slate-400 line-through" : ""}>{formatDate(u.createdAt, true)} · by {u.channel}: {u.summary}</li>)}
                </ul>
                {updates.some((u) => !u.undoneAt) ? <form action={undoOwnerChange.bind(null, r.id, returnTo)} className="mt-2"><button className="btn-secondary py-1 text-xs">Undo the latest change</button></form> : null}
              </div>
            ) : null}
          </div>

          <AssistantCard r={r} entitled callers={callers} returnTo={returnTo} staff={false} />

          <form action={saveCheckinSettings.bind(null, r.id, returnTo)} className="card space-y-3 text-sm">
            <h2>Check-in calls</h2>
            <p className="text-xs text-slate-500">When callers ask things {r.name} can&apos;t answer, callers need sorting, or a holiday is coming up, {r.name} calls you (at most once a week, weekdays 10–4) and learns your answers.</p>
            <label className="flex items-center gap-2"><input type="checkbox" name="checkinsOn" defaultChecked={r.checkinsOn} /> Call me with questions</label>
            <label className="flex items-center gap-2 text-xs text-slate-600">Once
              <select name="checkinThreshold" defaultValue={String(r.checkinThreshold)} className="input w-16 py-1">{[3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
              questions are waiting</label>
            <input name="checkinPhone" type="tel" defaultValue={r.checkinPhone ?? ""} placeholder={r.ringFirstNumber ? `Number to call (blank = ${prettyPhone(r.ringFirstNumber)})` : "Number to call"} className="input" aria-label="Number to call" />
            <button className="btn-secondary">Save</button>
          </form>
          <p className="text-xs text-slate-500">Notifications, reminders and your booking calendar are under <Link href={`/portal/settings${q}`}>Your setup</Link>.</p>
        </div>
      </div>
    </PortalShell>
  );
}
