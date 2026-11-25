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

  const activeFilters = [sp.view, sp.stage, sp.tag, sp.sort, sp.owner].filter(Boolean).length;
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

      <form className="mb-3 space-y-2 md:hidden">
        <div className="flex gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, domain, city, email…" className="input flex-1" aria-label="Search" />
          <button className="btn-secondary shrink-0">Search</button>
        </div>
        <details open={activeFilters > 0} className="rounded-xl border border-slate-200 bg-white px-3 py-1">
          <summary className="cursor-pointer text-sm font-semibold text-dawn-700">Filters &amp; sort{activeFilters ? ` (${activeFilters} on)` : ""}</summary>
          <div className="grid grid-cols-2 gap-2 py-2">
        <select name="owner" defaultValue={owner} className="input md:w-auto" aria-label="Owner">
          <option value="">Everyone&apos;s accounts</option>
          <option value="me">My accounts</option>
          <option value="unassigned">Unassigned</option>
          {team.filter((u) => u.id !== session.sub).map((u) => <option key={u.id} value={u.id}>{memberLabel(u)}</option>)}
        </select>
        <select name="view" defaultValue={sp.view ?? ""} className="input md:w-auto" aria-label="Prospects or clients">
          <option value="">All</option>
          <option value="prospects">Prospects</option>
          <option value="clients">Clients</option>
        </select>
        <select name="stage" defaultValue={sp.stage ?? ""} className="input md:w-auto" aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="input md:w-32" aria-label="Tag" />
        <select name="sort" defaultValue={sp.sort ?? ""} className="input md:w-auto" aria-label="Sort">
          <option value="">Recently updated</option>
          <option value="fit">Fit score</option>
          <option value="followup">Follow-up date</option>
          <option value="name">Name</option>
        </select>
        <button className="btn-secondary col-span-2 md:col-span-1">Filter</button>
            <button className="btn-secondary col-span-2">Apply</button>
          </div>
        </details>
      </form>
      <form className="mb-4 hidden flex-wrap gap-2 md:flex">
        <input name="q" defaultValue={sp.q} placeholder="Search name, domain, city, email…" className="input col-span-2 md:max-w-xs" aria-label="Search" />
        <select name="owner" defaultValue={owner} className="input md:w-auto" aria-label="Owner">
          <option value="">Everyone&apos;s accounts</option>
          <option value="me">My accounts</option>
          <option value="unassigned">Unassigned</option>
          {team.filter((u) => u.id !== session.sub).map((u) => <option key={u.id} value={u.id}>{memberLabel(u)}</option>)}
        </select>
        <select name="view" defaultValue={sp.view ?? ""} className="input md:w-auto" aria-label="Prospects or clients">
          <option value="">All</option>
          <option value="prospects">Prospects</option>
          <option value="clients">Clients</option>
        </select>
        <select name="stage" defaultValue={sp.stage ?? ""} className="input md:w-auto" aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="input md:w-32" aria-label="Tag" />
        <select name="sort" defaultValue={sp.sort ?? ""} className="input md:w-auto" aria-label="Sort">
          <option value="">Recently updated</option>
          <option value="fit">Fit score</option>
          <option value="followup">Follow-up date</option>
          <option value="name">Name</option>
        </select>
        <button className="btn-secondary col-span-2 md:col-span-1">Filter</button>
      </form>

      {accounts.length === 0 ? <Empty>No accounts match. Upload a CSV or ask Claude to find prospects.</Empty> : (
        <form action={bulkAccounts} className="flex flex-col">
          <div className="order-2 mt-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm md:order-none md:mb-2 md:mt-0 md:flex md:flex-wrap md:items-center md:border-0 md:bg-transparent md:p-0">
            <span className="text-slate-500">With selected:</span>
            <select name="op" className="input md:w-auto" defaultValue="research" aria-label="Action">
              <option value="research">Run Claude research</option>
              <option value="drive">Create Drive folders</option>
              {STAGES.map((s) => <option key={s} value={`stage:${s}`}>Move to {STAGE_LABELS[s]}</option>)}
              {isAdmin ? <>
                {team.map((u) => <option key={u.id} value={`owner:${u.id}`}>Assign to {memberLabel(u)}</option>)}
                <option value="owner:">Unassign</option>
                <option value="delete">Delete</option>
              </> : null}
            </select>
            {prompts.length ? (
              <select name="promptId" className="input md:w-auto" aria-label="Research prompt">
                {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
              </select>
            ) : null}
            <button className="btn-secondary">Apply</button>
          </div>
          <ul className="space-y-2 md:hidden">
            {accounts.map((a) => {
              const overdue = a.nextFollowUpAt && a.nextFollowUpAt < new Date();
              return (
                <li key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" name="ids" value={a.id} disabled={!canTouch(session, a.ownerId)} aria-label={`Select ${a.name}`} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/crm/accounts/${a.id}`} className="text-base font-semibold leading-snug text-dawn-900">{a.name}</Link>
                        <StageBadge stage={a.stage} />
                      </div>
                      <div className="mt-0.5 text-sm text-slate-600">{[a.industry, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—"}</div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>Owner: <b className={a.ownerId === session.sub ? "text-dawn-700" : ""}>{a.ownerId === session.sub ? "You" : memberLabel(a.owner)}</b></span>
                        {a.fitScore != null ? <span>Fit: <b>{a.fitScore}</b></span> : null}
                        <span>Last touch: {formatDate(a.lastContactedAt)}</span>
                        {a.nextFollowUpAt ? <span className={overdue ? "font-semibold text-red-600" : ""}>Follow up: {formatDate(a.nextFollowUpAt)}{overdue ? " (overdue)" : ""}</span> : null}
                      </div>
                      {splitTags(a.tags).length ? <div className="mt-1 text-xs">{splitTags(a.tags).slice(0, 3).map((t) => <Link key={t} href={`/crm/accounts?tag=${encodeURIComponent(t)}`} className="mr-2">#{t}</Link>)}</div> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="card hidden overflow-x-auto p-0 md:block">
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
