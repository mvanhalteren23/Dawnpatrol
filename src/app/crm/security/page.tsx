import type { SecurityIncident } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { Field, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { createIncident, updateIncident } from "./actions";

export const dynamic = "force-dynamic";

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

function IncidentFields({ i }: { i?: SecurityIncident }) {
  return (
    <>
      <Field label="What happened (short title)" className="sm:col-span-2"><input name="title" defaultValue={i?.title} required className="input" placeholder="e.g. Laptop with CRM access stolen" /></Field>
      <Field label="Discovered on"><input name="discoveredAt" type="date" defaultValue={d(i?.discoveredAt ?? new Date())} className="input" required /></Field>
      <Field label="Happened on (if known)"><input name="occurredAt" type="date" defaultValue={d(i?.occurredAt ?? null)} className="input" /></Field>
      <Field label="Details" className="sm:col-span-2"><textarea name="description" rows={3} defaultValue={i?.description} className="input" placeholder="How it happened and how you found out." /></Field>
      <Field label="Personal information involved" className="sm:col-span-2"><textarea name="dataInvolved" rows={2} defaultValue={i?.dataInvolved} className="input" placeholder="e.g. call recordings and phone numbers for 2 clients' callers" /></Field>
      <Field label="People affected (approx.)"><input name="peopleAffected" type="number" min={0} defaultValue={i?.peopleAffected ?? ""} className="input" /></Field>
      <Field label="Real risk of significant harm?">
        <select name="realRiskOfHarm" defaultValue={i?.realRiskOfHarm ?? "unknown"} className="input">
          <option value="unknown">Not assessed yet</option>
          <option value="yes">Yes: notify people and the regulator</option>
          <option value="no">No: record only</option>
        </select>
      </Field>
      <Field label="Containment and prevention" className="sm:col-span-2"><textarea name="containment" rows={2} defaultValue={i?.containment} className="input" placeholder="Passwords changed, access revoked, keys rotated, what changes stop a repeat." /></Field>
      <Field label="Clients notified on"><input name="clientsNotifiedAt" type="date" defaultValue={d(i?.clientsNotifiedAt ?? null)} className="input" /></Field>
      <Field label="Affected individuals notified on"><input name="individualsNotifiedAt" type="date" defaultValue={d(i?.individualsNotifiedAt ?? null)} className="input" /></Field>
      <Field label="Regulator notified on"><input name="regulatorNotifiedAt" type="date" defaultValue={d(i?.regulatorNotifiedAt ?? null)} className="input" /></Field>
      <Field label="Status">
        <select name="status" defaultValue={i?.status ?? "OPEN"} className="input">
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
        </select>
      </Field>
    </>
  );
}

// Breach register and response plan (admins). Records are kept at least 24 months.
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const incidents = await db.securityIncident.findMany({ orderBy: { discoveredAt: "desc" } });
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Security & breaches" subtitle="The breach register and what to do if personal information is lost, stolen or seen by someone who shouldn't." />
      <Flash params={sp} />

      <div className="card space-y-3 text-sm">
        <h2>If you think there&apos;s been a breach</h2>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li><b>Contain it now.</b> Change the affected passwords, revoke access (CRM Settings → Users → Turn off sign-in), rotate any exposed API keys in Vercel (Twilio, ElevenLabs, Google, AUTH_SECRET signs everyone out), and keep evidence.</li>
          <li><b>Record it below</b> the same day, even if it turns out to be minor. Every breach of security safeguards must be recorded and the record kept for at least 24 months.</li>
          <li><b>Tell the affected clients</b> promptly. It&apos;s usually their customers&apos; information (callers&apos; names, numbers, recordings), and your agreement with them should say how fast.</li>
          <li><b>Assess the risk.</b> Consider how sensitive the information is and how likely it is to be misused. If there&apos;s a <i>real risk of significant harm</i> (identity theft, financial loss, humiliation, damage to reputation or relationships), notify the affected individuals and the regulator as soon as possible: the Office of the Privacy Commissioner of Canada (federal PIPEDA) and/or the Office of the Information and Privacy Commissioner for BC (BC PIPA).</li>
          <li><b>Tell your insurer</b> right away if you have cyber cover. Most policies require prompt notice and give you breach-response help (lawyers, forensics, notification).</li>
          <li><b>Fix the cause,</b> note what changed, and close the record.</li>
        </ol>
        <p className="text-xs text-slate-500">General guidance, not legal advice. Check the current rules with the regulators or a privacy lawyer when a real breach happens.</p>
      </div>

      <form action={createIncident} className="card grid gap-3 sm:grid-cols-2">
        <h2 className="sm:col-span-2">Record an incident</h2>
        <IncidentFields />
        <div className="sm:col-span-2"><button className="btn">Save to the register</button></div>
      </form>

      <div className="card space-y-4">
        <h2>Breach register ({incidents.length})</h2>
        {!incidents.length ? <p className="text-sm text-slate-500">No incidents recorded. That&apos;s the record too: keep this page as your evidence for insurers and regulators.</p> : null}
        {incidents.map((i) => (
          <details key={i.id} className="rounded-lg border border-slate-200 p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <b>{i.title}</b>
              <StatusBadge status={i.status} />
              <span className="text-xs text-slate-500">discovered {d(i.discoveredAt)} · {i.peopleAffected ?? "?"} people · risk of harm: {i.realRiskOfHarm}</span>
            </summary>
            <form action={updateIncident.bind(null, i.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
              <IncidentFields i={i} />
              <div className="sm:col-span-2"><button className="btn-secondary">Save changes</button></div>
            </form>
          </details>
        ))}
      </div>
    </div>
  );
}
