import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/team";
import { formatDate } from "@/lib/utils";
import { Badge, Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { createUser, resetUserPassword, setUserAccess, updateUser } from "./actions";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireAdmin();
  const [users, owned] = await Promise.all([
    db.user.findMany({ where: { role: { in: ["ADMIN", "REP"] } }, orderBy: [{ disabled: "asc" }, { createdAt: "asc" }] }),
    db.account.groupBy({ by: ["ownerId"], _count: true }),
  ]);
  const ownedBy = new Map(owned.map((o) => [o.ownerId, o._count]));
  const active = users.filter((u) => !u.disabled);
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Team & users"
        subtitle={`${active.length} people can sign in to the CRM · ${ownedBy.get(null) ?? 0} accounts unassigned`}
        actions={<Link href="/crm/team" className="btn-secondary">Team activity →</Link>}
      />
      <Flash params={await searchParams} />

      <div className="card text-sm text-slate-600">
        <p><b>Administrators</b> can do everything: add users, change settings and billing, manage receptionists, delete accounts and move accounts between reps.</p>
        <p className="mt-1"><b>Sales reps</b> see every account (so nothing is added twice), but can only work (call, email, edit, add notes) the accounts they own. An unassigned account becomes theirs the first time they work it. They see their own and the team&apos;s activity.</p>
        <p className="mt-1">Client portal logins are added from each client&apos;s account page.</p>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Accounts</th><th className="px-3 py-2">Last sign-in</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? "opacity-60" : ""}>
                <td className="px-3 py-2 align-top" colSpan={2}>
                  <form action={updateUser.bind(null, u.id)} className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[12rem]">
                      <input name="name" defaultValue={u.name ?? ""} placeholder="Name" className="input py-1" aria-label="Name" />
                      <div className="mt-0.5 text-xs text-slate-500">{u.email}{u.id === session.sub ? " (you)" : ""}</div>
                    </div>
                    <select name="role" defaultValue={u.role} className="input w-auto py-1" aria-label="Role" disabled={u.disabled}>
                      <option value="REP">{ROLE_LABELS.REP}</option>
                      <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                    </select>
                    {u.disabled ? <Badge className="bg-slate-200 text-slate-700">no access</Badge> : <button className="btn-secondary py-1 text-xs">Save</button>}
                  </form>
                </td>
                <td className="px-3 py-2 align-top"><Link href={`/crm/accounts?owner=${u.id}`}>{ownedBy.get(u.id) ?? 0}</Link></td>
                <td className="px-3 py-2 align-top text-xs text-slate-500">{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "never"}</td>
                <td className="px-3 py-2 align-top">
                  <details className="text-xs">
                    <summary className="cursor-pointer text-dawn-700">Manage</summary>
                    <div className="mt-2 w-64 space-y-3">
                      <form action={resetUserPassword.bind(null, u.id)} className="space-y-1">
                        <input name="password" type="text" minLength={10} required placeholder="New temporary password (10+)" className="input py-1" autoComplete="off" />
                        <button className="btn-secondary py-1 text-xs">Reset password</button>
                      </form>
                      {u.disabled ? (
                        <form action={setUserAccess.bind(null, u.id)}>
                          <input type="hidden" name="action" value="enable" />
                          <button className="btn-secondary py-1 text-xs">Turn sign-in back on</button>
                        </form>
                      ) : u.id !== session.sub ? (
                        <form action={setUserAccess.bind(null, u.id)} className="space-y-1">
                          <input type="hidden" name="action" value="disable" />
                          <label className="block text-slate-600">Their accounts go to
                            <select name="reassignTo" className="input mt-1 py-1" defaultValue={session.sub}>
                              <option value="">Nobody (unassigned)</option>
                              {active.filter((x) => x.id !== u.id).map((x) => <option key={x.id} value={x.id}>{x.name || x.email}</option>)}
                            </select>
                          </label>
                          <button className="btn-danger py-1 text-xs">Turn off sign-in</button>
                        </form>
                      ) : null}
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-3">Add a person</h2>
        <form action={createUser} className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><input name="name" className="input" placeholder="Jordan Lee" /></Field>
          <Field label="Email (their sign-in)"><input name="email" type="email" required className="input" /></Field>
          <Field label="Role">
            <select name="role" defaultValue="REP" className="input">
              <option value="REP">{ROLE_LABELS.REP}</option>
              <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
            </select>
          </Field>
          <Field label="Temporary password (10+ characters)"><input name="password" type="text" minLength={10} required className="input" autoComplete="off" /></Field>
          <div className="md:col-span-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">They sign in at <code>{app || ""}/login</code> and can change the password under Settings.</p>
            <button className="btn">Add person</button>
          </div>
        </form>
      </div>
    </div>
  );
}
