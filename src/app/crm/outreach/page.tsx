import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { googleConnection } from "@/lib/google";
import { getSetting } from "@/lib/settings";
import { contactName, formatDate } from "@/lib/utils";
import { Badge, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { syncOutreachNow } from "../actions";

export const dynamic = "force-dynamic";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ type?: string; days?: string; scope?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const session = await requireStaff();
  const days = Math.min(365, Number(sp.days ?? 30) || 30);
  const since = new Date(Date.now() - days * 86400000);
  // Mine = touches on accounts I own; Team = everyone's.
  const scope = sp.scope === "me" || sp.scope === "team" ? sp.scope : session.role === "ADMIN" ? "team" : "me";
  const scoped: Prisma.ActivityWhereInput = scope === "me" ? { account: { ownerId: session.sub } } : {};
  const where: Prisma.ActivityWhereInput = { occurredAt: { gte: since }, direction: { not: null }, ...scoped, ...(sp.type ? { type: sp.type } : {}) };
  const [activities, google, lastSync, outbound, replied, opened, inbound] = await Promise.all([
    db.activity.findMany({ where, orderBy: { occurredAt: "desc" }, take: 200, include: { account: true, contact: true } }),
    googleConnection(),
    getSetting("gmail.lastSyncAt"),
    db.activity.count({ where: { ...scoped, occurredAt: { gte: since }, direction: "OUTBOUND" } }),
    db.activity.count({ where: { ...scoped, occurredAt: { gte: since }, direction: "OUTBOUND", repliedAt: { not: null } } }),
    db.activity.count({ where: { ...scoped, occurredAt: { gte: since }, type: "EMAIL", direction: "OUTBOUND", openCount: { gt: 0 } } }),
    db.activity.count({ where: { ...scoped, occurredAt: { gte: since }, direction: "INBOUND" } }),
  ]);
  const emailsSent = await db.activity.count({ where: { ...scoped, occurredAt: { gte: since }, type: "EMAIL", direction: "OUTBOUND", source: "crm-send" } });

  return (
    <div>
      <PageHeader
        title="Outreach"
        subtitle={`Every touch across all accounts — last ${days} days`}
        actions={<>
          <Link href="/crm/outreach/writer" className="btn-secondary">✍️ Email writer</Link>
          {google.connected ? <form action={syncOutreachNow}><SubmitButton className="btn-secondary" pendingText="Syncing…">Sync Gmail now</SubmitButton></form> : <Link href="/crm/settings" className="btn">Connect Gmail</Link>}
        </>}
      />
      <Flash params={sp} />
      <Notice>
        Tracking is automatic: Gmail is scanned every 30 minutes{lastSync ? ` (last sync ${formatDate(lastSync, true)})` : ""} and matched to contacts by email or company domain; emails sent from the CRM track opens and clicks;
        sequencers (Instantly, Lemlist, Smartlead, Zapier) can post to <code>/api/webhooks/outreach</code>. Stages and follow-up dates update themselves.
      </Notice>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Outbound touches" value={outbound} />
        <Stat label="Replies / inbound" value={inbound} sub={outbound ? `${Math.round((replied / outbound) * 100)}% of outbound got a reply` : undefined} />
        <Stat label="Tracked emails opened" value={emailsSent ? `${Math.round((opened / emailsSent) * 100)}%` : "—"} sub={`${emailsSent} sent from CRM`} />
        <Stat label="Accounts touched" value={new Set(activities.map((a) => a.accountId)).size} />
      </div>
      <form className="mb-3 flex gap-2">
        <select name="type" defaultValue={sp.type ?? ""} className="input w-auto"><option value="">All channels</option>{["EMAIL", "CALL", "SMS", "LINKEDIN", "MEETING"].map((t) => <option key={t}>{t}</option>)}</select>
        <select name="scope" defaultValue={scope} className="input w-auto" aria-label="Whose outreach"><option value="me">My accounts</option><option value="team">Whole team</option></select>
        <select name="days" defaultValue={String(days)} className="input w-auto">{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
        <button className="btn-secondary">Filter</button>
      </form>
      {activities.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>When</th><th>Account</th><th>Channel</th><th>Subject</th><th>Engagement</th><th>Source</th></tr></thead>
            <tbody>{activities.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-xs">{formatDate(a.occurredAt, true)}</td>
                <td><Link href={`/crm/accounts/${a.accountId}`}>{a.account.name}</Link>{a.contact ? <div className="text-xs text-slate-500">{contactName(a.contact)}</div> : null}</td>
                <td><Badge>{a.type.toLowerCase()}</Badge> <span className="text-xs text-slate-500">{a.direction?.toLowerCase()}</span></td>
                <td className="max-w-xs truncate">{a.subject}</td>
                <td className="text-xs">{a.direction === "OUTBOUND" && a.type === "EMAIL" ? `👁 ${a.openCount} · 🔗 ${a.clickCount}${a.repliedAt ? " · ↩" : ""}` : ""}</td>
                <td className="text-xs text-slate-500">{a.source}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>No touches in this window.</Empty>}
    </div>
  );
}
