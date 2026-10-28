import { STAGES, STAGE_LABELS } from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import { memberLabel, teamMembers } from "@/lib/team";
import { Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { createAccount } from "../../actions";

export default async function NewAccount({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireStaff();
  const team = session.role === "ADMIN" ? await teamMembers() : [];
  return (
    <div className="max-w-2xl">
      <PageHeader title="New account" subtitle="The CRM checks the website, phone number and name against every account on the team, so nothing is added twice." />
      <Flash params={await searchParams} />
      <form action={createAccount} className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company name"><input name="name" className="input" required /></Field>
        <Field label="Website"><input name="website" className="input" placeholder="acmeplumbing.com" /></Field>
        <Field label="Phone"><input name="phone" className="input" /></Field>
        <Field label="Industry"><input name="industry" className="input" placeholder="HVAC, dental, legal…" /></Field>
        <Field label="City"><input name="city" className="input" /></Field>
        <Field label="State"><input name="state" className="input" /></Field>
        <Field label="Stage">
          <select name="stage" className="input" defaultValue="PROSPECT">{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
        </Field>
        <Field label="Tags (comma separated)"><input name="tags" className="input" /></Field>
        {session.role === "ADMIN" ? (
          <Field label="Account owner">
            <select name="ownerId" className="input" defaultValue={session.sub}>
              <option value="">Unassigned</option>
              {team.map((u) => <option key={u.id} value={u.id}>{memberLabel(u)}{u.id === session.sub ? " (you)" : ""}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Contact name"><input name="contactName" className="input" /></Field>
        <Field label="Contact email"><input name="contactEmail" type="email" className="input" /></Field>
        <Field label="Contact title"><input name="contactTitle" className="input" /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={3} className="input" /></Field>
        <div className="sm:col-span-2"><button className="btn">Create account</button></div>
      </form>
    </div>
  );
}
