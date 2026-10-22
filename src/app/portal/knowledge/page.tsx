import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { KnowledgeBaseEditor } from "@/components/KnowledgeBaseEditor";
import { TestChat } from "@/components/TestChat";

export const dynamic = "force-dynamic";

export default async function PortalKnowledge({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const items = receptionist ? await db.knowledgeItem.findMany({ where: { receptionistId: receptionist.id }, orderBy: [{ category: "asc" }, { title: "asc" }] }) : [];
  return (
    <PortalShell accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">Knowledge base</h1>
      <p className="mb-6 text-sm text-slate-500">This is what your AI receptionist knows. Changes go live after the Dawn Patrol team syncs them (usually same day).</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {!receptionist ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3"><KnowledgeBaseEditor receptionistId={receptionist.id} items={items} returnTo={`/portal/knowledge${q}`} /></div>
          <div className="lg:col-span-2"><TestChat receptionistId={receptionist.id} greeting={receptionist.greeting || `Thanks for calling ${receptionist.businessName}, this is ${receptionist.name}. How can I help you today?`} /></div>
        </div>
      )}
    </PortalShell>
  );
}
