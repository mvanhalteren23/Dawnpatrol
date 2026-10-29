import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { companyName } from "@/lib/brand";
import { KnowledgeBaseView } from "@/components/KnowledgeBaseView";
import { RequestChangeForm } from "@/components/RequestChangeForm";
import { TestChat } from "@/components/TestChat";

export const dynamic = "force-dynamic";

// Managed service: clients see what their receptionist knows and request changes; the team edits it.
export default async function PortalKnowledge({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const [items, company] = await Promise.all([
    receptionist ? db.knowledgeItem.findMany({ where: { receptionistId: receptionist.id }, orderBy: [{ category: "asc" }, { title: "asc" }] }) : [],
    companyName(),
  ]);
  const returnTo = `/portal/knowledge${q}`;
  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">What your receptionist knows</h1>
      <p className="mb-6 text-sm text-slate-500">Your receptionist answers callers from this information. The {company} team keeps it up to date: if anything has changed, send a request and we&apos;ll update and test it for you.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {!receptionist ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3"><KnowledgeBaseView items={items} /></div>
          <div className="space-y-6 lg:col-span-2">
            <RequestChangeForm receptionistId={receptionist.id} returnTo={returnTo} defaultTopic="Services or prices" />
            <TestChat receptionistId={receptionist.id} greeting={receptionist.greeting || `Thanks for calling ${receptionist.businessName}, this is ${receptionist.name}. How can I help you today?`} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
