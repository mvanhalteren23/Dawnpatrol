import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { canTouch, memberLabel, teamMembers } from "@/lib/team";
import { CLIENT_STAGES, PROSPECT_STAGES, STAGES, STAGE_LABELS } from "@/lib/constants";
import { formatDate, splitTags } from "@/lib/utils";
import { Empty, PageHeader, StageBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { bulkAccounts } from "../actions";

export const dynamic = "force-dynamic";

type Search = { q?: string; stage?: string; view?: string; tag?: string; sort?: string; owner?: string; notice?: string; error?: string };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const session = await requireStaff();
  const isAdmin = session.role === "ADMIN";
  // Everyone can see every account (so nothing gets added twice); reps start on their own book.
  const owner = sp.owner ?? (isAdmin ? "" : "me");
  const where: Prisma.AccountWhereInput = {};
  if (owner === "me") where.ownerId = session.sub;
  else if (owner === "unassigned") where.ownerId = null;
  else if (owner) where.ownerId = owner;
  if (sp.stage) where.stage = sp.stage;
  else if (sp.view === "prospects") where.stage = { in: PROSPECT_STAGES };
  else if (sp.view === "clients") where.stage = { in: CLIENT_STAGES };
  if (sp.tag) where.tags = { contains: sp.tag, mode: "insensitive" };
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { domain: { contains: sp.q, mode: "insensitive" } },
      { city: { contains: sp.q, mode: "insensitive" } },
      { industry: { contains: sp.q, mode: "insensitive" } },
      { contacts: { some: { OR: [{ email: { contains: sp.q, mode: "insensitive" } }, { lastName: { contains: sp.q, mode: "insensitive" } }] } } },
    ];
  }
  const orderBy: Prisma.AccountOrderByWithRelationInput =
    sp.sort === "fit" ? { fitScore: { sort: "desc", nulls: "last" } } : sp.sort === "followup" ? { nextFollowUpAt: { sort: "asc", nulls: "last" } } : sp.sort === "name" ? { name: "asc" } : { updatedAt: "desc" };

  const [accounts, total, prompts, team] = await Promise.all([
    db.account.findMany({ where, orderBy, take: 300, include: { _count: { select: { contacts: true, activities: true } }, subscription: true, owner: { select: { name: true, email: true } } } }),
    db.account.count({ where }),
    db.savedPrompt.findMany({ where: { kind: "RESEARCH" }, orderBy: { name: "asc" } }),
    teamMembers(),
  ]);

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle={`${total} accounts${total > accounts.length ? ` (showing ${accounts.length})` : ""}`}
        actions={<>
          <Link href="/crm/accounts/import" className="btn-secondary">Bulk upload CSV</Link>
          <Link href="/crm/prospecting" className="btn-secondary">Find prospects with Claude</Link>
          <Link href="/crm/accounts/new" className="btn">+ New account</Link>
        </>}
      />
      <Flash params={sp} />

      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, domain, city, email…" className="input max-w-xs" />
        <select name="owner" defaultValue={owner} className="input w-auto" aria-label="Owner">
          <option value="">Everyone&apos;s accounts</option>
          <option value="me">My accounts</option>
          <option value="unassigned">Unassigned</option>
          {team.filter((u) => u.id !== session.sub).map((u) => <option key={u.id} value={u.id}>{memberLabel(u)}</option>)}
        </select>
        <select name="view" defaultValue={sp.view ?? ""} className="input w-auto">
          <option value="">All</option>
          <option value="prospects">Prospects</option>
          <option value="clients">Clients</option>
        </select>
        <select name="stage" defaultValue={sp.stage ?? ""} className="input w-auto">
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="input w-32" />
        <select name="sort" defaultValue={sp.sort ?? ""} className="input w-auto">
          <option value="">Recently updated</option>
          <option value="fit">Fit score</option>
          <option value="followup">Follow-up date</option>
          <option value="name">Name</option>
        </select>
        <button className="btn-secondary">Filter</button>
      </form>

      {accounts.length === 0 ? <Empty>No accounts match. Upload a CSV or ask Claude to find prospects.</Empty> : (
        <form action={bulkAccounts}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">With selected:</span>
            <select name="op" className="input w-auto" defaultValue="research">
              <option value="research">Run Claude research</option>
              <option value="drive">Create Drive folders</option>
              {STAGES.map((s) => <option key={s} value={`stage:${s}`}>Move to {STAGE_LABELS[s]}</option>)}
              {isAdmin ? <>
                {team.map((u) => <option key={u.id} value={`owner:${u.id}`}>Assign to {memberLabel(u)}</option>)}
                <option value="owner:">Unassign</option>
                <option value="delete">Delete</option>
              </> : null}
            </select>
            <select name="promptId" className="input w-auto">
              {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
            </select>
            <button className="btn-secondary">Apply</button>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr><th></th><th>Account</th><th>Owner</th><th>Stage</th><th>Fit</th><th>Location</th><th>Tags</th><th>Last touch</th><th>Follow-up</th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td><input type="checkbox" name="ids" value={a.id} disabled={!canTouch(session, a.ownerId)} title={canTouch(session, a.ownerId) ? undefined : "Owned by another rep"} /></td>
                    <td>
                      <Link href={`/crm/accounts/${a.id}`} className="font-medium">{a.name}</Link>
                      <div className="text-xs text-slate-500">{a.domain ?? "—"} · {a.industry ?? "—"} · {a._count.contacts} contacts</div>
                    </td>
                    <td className={`text-xs ${a.ownerId === session.sub ? "font-medium text-dawn-700" : a.ownerId ? "" : "text-slate-400"}`}>{a.ownerId === session.sub ? "You" : memberLabel(a.owner)}</td>
                    <td><StageBadge stage={a.stage} /></td>
                    <td>{a.fitScore ?? "—"}</td>
                    <td className="text-xs">{[a.city, a.state].filter(Boolean).join(", ") || "—"}</td>
                    <td className="text-xs">{splitTags(a.tags).slice(0, 3).map((t) => <Link key={t} href={`/crm/accounts?tag=${encodeURIComponent(t)}`} className="mr-1">#{t}</Link>)}</td>
                    <td className="text-xs">{formatDate(a.lastContactedAt)}</td>
                    <td className={`text-xs ${a.nextFollowUpAt && a.nextFollowUpAt < new Date() ? "text-red-600" : ""}`}>{formatDate(a.nextFollowUpAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </div>
  );
}
