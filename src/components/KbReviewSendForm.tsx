"use client";

import { useState } from "react";

type Person = { id: string; name: string; firstName: string; email: string | null; phone: string | null };
type Agent = { id: string; label: string; drafts: number };

/**
 * Send the client the knowledge-base review link by email, text or both. Picking a contact fills in
 * their email and mobile; both can be edited. With `agents`, the receptionist is picked here too
 * (the account page); otherwise the action is already bound to one.
 */
export function KbReviewSendForm({ action, people, agents }: { action: (form: FormData) => void | Promise<void>; people: Person[]; agents?: Agent[] }) {
  const first = people[0];
  const [email, setEmail] = useState(first?.email ?? "");
  const [phone, setPhone] = useState(first?.phone ?? "");
  const [firstName, setFirstName] = useState(first?.firstName ?? "");
  const [byEmail, setByEmail] = useState(Boolean(first?.email));
  const [byText, setByText] = useState(Boolean(first?.phone) && !first?.email);
  const pick = (id: string) => {
    const p = people.find((x) => x.id === id);
    setEmail(p?.email ?? "");
    setPhone(p?.phone ?? "");
    setFirstName(p?.firstName ?? "");
    setByEmail(Boolean(p?.email));
    setByText(Boolean(p?.phone) && !p?.email);
  };
  return (
    <form action={action} className="space-y-2 text-sm">
      {agents ? (
        <label className="block"><span className="label">Receptionist</span>
          <select name="receptionistId" className="input" defaultValue={agents[0]?.id}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.label}{a.drafts ? ` (${a.drafts} to review)` : ""}</option>)}
          </select>
        </label>
      ) : null}
      {people.length ? (
        <label className="block"><span className="label">Send to</span>
          <select className="input" defaultValue={first?.id} onChange={(e) => pick(e.target.value)} aria-label="Contact">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.email ? ` · ${p.email}` : ""}{p.phone ? ` · ${p.phone}` : ""}</option>)}
            <option value="">Someone else…</option>
          </select>
        </label>
      ) : null}
      <input type="hidden" name="firstName" value={firstName} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="byEmail" checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} /><input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input" aria-label="Email" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="byText" checked={byText} onChange={(e) => setByText(e.target.checked)} /><input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" className="input" aria-label="Mobile" /></label>
      </div>
      <p className="text-xs text-slate-500">Tick email, text or both. Leave both unticked to just create the link and copy it.</p>
      <button className="btn">{byEmail && byText ? "Email and text the link" : byText ? "Text the link" : byEmail ? "Email the link" : "Create link"}</button>
    </form>
  );
}
