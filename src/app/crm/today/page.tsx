import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { healthBoard } from "@/lib/client-health";
import { parsePrefs } from "@/lib/push-rules";
import { bestNumber, dueLabel, endOfLocalDay } from "@/lib/today-rules";
import { Flash } from "@/components/Flash";
import { todayDone, todayReplyHandled, todayReviewed, todaySnooze } from "./actions";

export const dynamic = "force-dynamic";

// The phone home screen: everything that needs you today, each with a one-tap action.

type Item = {
  key: string;
  title: string;
  href: string;
  detail: string;
  badge?: { text: string; tone: "red" | "amber" | "green" | "slate" };
  phone?: string | null;
  actions?: React.ReactNode;
};

const TONES = {
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-emerald-100 text-emerald-800",
  slate: "bg-slate-100 text-slate-700",
};

function Section({ title, count, empty, children }: { title: string; count: number; empty?: string; children: React.ReactNode }) {
  if (!count && !empty) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-lg">
        {title}
        {count ? <span className="rounded-full bg-dawn-900 px-2 py-0.5 text-xs font-semibold text-dawn-100">{count}</span> : null}
      </h2>
      {count ? <ul className="space-y-2">{children}</ul> : <p className="text-sm text-slate-500">{empty}</p>}
    </section>
  );
}

function Row({ item }: { item: Item }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link href={item.href} className="min-w-0 flex-1 hover:no-underline">
          <div className="truncate font-semibold text-dawn-900">{item.title}</div>
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{item.detail}</p>
        </Link>
        {item.badge ? <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[item.badge.tone]}`}>{item.badge.text}</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.phone ? (
          <>
            <a href={`tel:${item.phone}`} className="btn min-h-11 flex-1 justify-center py-2 hover:no-underline">Call</a>
            <a href={`sms:${item.phone}`} className="btn-secondary min-h-11 flex-1 justify-center py-2 hover:no-underline">Text</a>
          </>
        ) : null}
        {item.actions}
        <Link href={item.href} className="btn-secondary min-h-11 flex-1 justify-center py-2 hover:no-underline">Open</Link>
      </div>
    </li>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireStaff();
  const isAdmin = session.role === "ADMIN";
  const me = await db.user.findUniqueOrThrow({ where: { id: session.sub }, select: { name: true, pushPrefs: true, phone: true, _count: { select: { pushSubscriptions: true, passkeys: true } } } });
  const tz = parsePrefs(me.pushPrefs).timezone;
  const now = new Date();
  const endToday = endOfLocalDay(now, tz);
  // Reps see their own accounts and unassigned ones; administrators see everything.
  const mine = isAdmin ? {} : { OR: [{ ownerId: session.sub }, { ownerId: null }] };

  const [board, tasks, review, replies] = await Promise.all([
    healthBoard(isAdmin ? null : session.sub, now),
    db.activity.findMany({
      where: { type: "TASK", completedAt: null, dueAt: { lte: endToday }, account: mine },
      orderBy: { dueAt: "asc" },
      take: 40,
      select: { id: true, subject: true, body: true, dueAt: true, accountId: true, account: { select: { name: true, phone: true, contacts: { select: { phone: true, isPrimary: true } } } }, contact: { select: { phone: true } } },
    }),
    db.account.findMany({
      where: { needsReview: true, ...mine },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, name: true, reviewReason: true, phone: true, contacts: { select: { phone: true, isPrimary: true } } },
    }),
    db.campaignRecipient.findMany({
      where: { status: "REPLIED", repliedAt: { gte: new Date(now.getTime() - 14 * 24 * 3600_000) }, account: mine },
      orderBy: { repliedAt: "desc" },
      take: 20,
      select: { id: true, email: true, firstName: true, note: true, repliedAt: true, accountId: true, account: { select: { name: true, phone: true, contacts: { select: { phone: true, isPrimary: true } } } } },
    }),
  ]);

  const attention = board.rows.filter((r) => r.status === "attention");
  const waiting = board.rows.filter((r) => r.status !== "attention" && (r.openQuestions > 0 || r.unhandledLeads > 0));
  const clientPhones = new Map(
    (await db.account.findMany({ where: { id: { in: [...attention, ...waiting].map((r) => r.accountId) } }, select: { id: true, phone: true, contacts: { select: { phone: true, isPrimary: true } } } })).map((a) => [a.id, bestNumber(a.phone, a.contacts)]),
  );

  const total = attention.length + tasks.length + review.length + replies.length;
  const hello = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(now);
  const firstName = me.name?.split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">{hello}</p>
        <h1>{firstName ? `Hi ${firstName}` : "Today"}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {total ? `${total} thing${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} you.` : "All clear. Nothing needs you right now."}
        </p>
      </div>
      <Flash params={await searchParams} />

      {!me._count.pushSubscriptions || !me._count.passkeys || !me.phone ? (
        <div className="rounded-2xl border border-dawn-400 bg-dawn-50 p-4 text-sm">
          <p className="font-semibold text-dawn-900">Finish setting up the app</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
            {!me._count.pushSubscriptions ? <li>Turn on notifications so line problems and new leads reach you</li> : null}
            {!me._count.passkeys ? <li>Add a passkey to sign in with your fingerprint</li> : null}
            {!me.phone ? <li>Add your mobile for &quot;Call my phone&quot; dialing</li> : null}
          </ul>
          <Link href="/crm/settings#phone-app" className="btn mt-3 min-h-11 justify-center hover:no-underline">Set up</Link>
        </div>
      ) : null}

      <Section title="Lines needing attention" count={attention.length}>
        {attention.map((r) => (
          <Row
            key={r.receptionistId}
            item={{ key: r.receptionistId, title: r.account, href: `/crm/accounts/${r.accountId}`, detail: r.reasons.filter((x) => x.level === "attention").map((x) => x.text).join(" · "), badge: { text: "Attention", tone: "red" }, phone: clientPhones.get(r.accountId) }}
          />
        ))}
      </Section>

      <Section title="New leads to check" count={review.length}>
        {review.map((a) => (
          <Row
            key={a.id}
            item={{
              key: a.id,
              title: a.name,
              href: `/crm/accounts/${a.id}`,
              detail: a.reviewReason ?? "Added or updated automatically: check the details.",
              badge: { text: "New", tone: "green" },
              phone: bestNumber(a.phone, a.contacts),
              actions: <form action={todayReviewed.bind(null, a.id)} className="flex flex-1"><button className="btn-secondary min-h-11 w-full py-2">Checked</button></form>,
            }}
          />
        ))}
      </Section>

      <Section title="Follow-ups due" count={tasks.length} empty="No follow-ups due today.">
        {tasks.map((t) => {
          const due = t.dueAt ? dueLabel(t.dueAt, now, tz) : null;
          return (
            <Row
              key={t.id}
              item={{
                key: t.id,
                title: t.account.name,
                href: `/crm/accounts/${t.accountId}`,
                detail: t.subject ?? t.body ?? "Follow up",
                badge: due ? { text: due.text, tone: due.overdue ? "amber" : "slate" } : undefined,
                phone: t.contact?.phone ?? bestNumber(t.account.phone, t.account.contacts),
                actions: (
                  <>
                    <form action={todayDone.bind(null, t.id)} className="flex flex-1"><button className="btn-secondary min-h-11 w-full py-2">Done</button></form>
                    <form action={todaySnooze.bind(null, t.id, tz)} className="flex flex-1"><button className="btn-secondary min-h-11 w-full py-2">Tomorrow</button></form>
                  </>
                ),
              }}
            />
          );
        })}
      </Section>

      <Section title="Replies to answer" count={replies.length}>
        {replies.map((r) => (
          <Row
            key={r.id}
            item={{
              key: r.id,
              title: r.account.name,
              href: `/crm/accounts/${r.accountId}`,
              detail: `${r.firstName ?? r.email} replied to your email${r.note ? `: ${r.note}` : "."}`,
              badge: { text: "Reply", tone: "green" },
              phone: bestNumber(r.account.phone, r.account.contacts),
              actions: <form action={todayReplyHandled.bind(null, r.id)} className="flex flex-1"><button className="btn-secondary min-h-11 w-full py-2">Handled</button></form>,
            }}
          />
        ))}
      </Section>

      <Section title="Waiting on clients" count={waiting.length}>
        {waiting.map((r) => (
          <Row
            key={r.receptionistId}
            item={{
              key: r.receptionistId,
              title: r.account,
              href: `/crm/accounts/${r.accountId}`,
              detail: [r.openQuestions ? `${r.openQuestions} caller question${r.openQuestions === 1 ? "" : "s"} the owner hasn't answered${r.topQuestion ? ` (e.g. "${r.topQuestion}")` : ""}` : null, r.unhandledLeads ? `${r.unhandledLeads} lead${r.unhandledLeads === 1 ? "" : "s"} not followed up` : null].filter(Boolean).join(" · "),
              badge: { text: "Nudge", tone: "slate" },
              phone: clientPhones.get(r.accountId),
            }}
          />
        ))}
      </Section>

      <div className="grid grid-cols-2 gap-2 pt-2 text-sm">
        <Link href="/crm/dialer" className="btn-secondary min-h-12 justify-center hover:no-underline">Open the dialer</Link>
        <Link href="/crm/health" className="btn-secondary min-h-12 justify-center hover:no-underline">Client health</Link>
        <Link href="/crm/accounts/new" className="btn-secondary min-h-12 justify-center hover:no-underline">New account</Link>
        <Link href="/crm" className="btn-secondary min-h-12 justify-center hover:no-underline">Dashboard</Link>
      </div>
    </div>
  );
}
