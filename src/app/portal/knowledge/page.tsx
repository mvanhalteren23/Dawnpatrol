import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { companyName } from "@/lib/brand";
import { KnowledgeBaseEditor } from "@/components/KnowledgeBaseEditor";
import { KbHistory } from "@/components/KbHistory";
import { OpenQuestions } from "@/components/CustomerCare";
import { defaultGreeting } from "@/lib/safety-rules";
import { kbHistory } from "@/lib/kb-history";
import { RequestChangeForm } from "@/components/RequestChangeForm";
import { TestChat } from "@/components/TestChat";

export const dynamic = "force-dynamic";

// Clients add to and edit what their receptionist knows (live straight away, every change undoable);
// the team can edit it too, from the CRM. Bigger changes still go through Request a change.
export default async function PortalKnowledge({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const [items, company, history, questions] = await Promise.all([
    receptionist ? db.knowledgeItem.findMany({ where: { receptionistId: receptionist.id }, orderBy: [{ category: "asc" }, { title: "asc" }] }) : [],
    companyName(),
    receptionist ? kbHistory(receptionist.id) : [],
    receptionist ? db.openQuestion.findMany({ where: { receptionistId: receptionist.id, status: "OPEN" }, orderBy: [{ kind: "desc" }, { askedCount: "desc" }] }) : [],
  ]);
  const returnTo = `/portal/knowledge${q}`;
  return (
    <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">What your receptionist knows</h1>
      <p className="mb-6 text-sm text-slate-500">Your receptionist answers callers from this information. Add or change anything here and it goes live within a minute; every change can be undone under History. For anything bigger (how calls are handled, hours, transfers), send the {company} team a request.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {!receptionist ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <OpenQuestions r={receptionist} questions={questions} returnTo={returnTo} />
            <KnowledgeBaseEditor receptionistId={receptionist.id} items={items} returnTo={returnTo} client />
            <KbHistory receptionistId={receptionist.id} revisions={history} returnTo={returnTo} teamName={`${company} team`} />
          </div>
          <div className="space-y-6 lg:col-span-2">
            <RequestChangeForm receptionistId={receptionist.id} returnTo={returnTo} defaultTopic="Services or prices" />
            <TestChat receptionistId={receptionist.id} greeting={receptionist.greeting || defaultGreeting({ businessName: receptionist.businessName, name: receptionist.name })} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
