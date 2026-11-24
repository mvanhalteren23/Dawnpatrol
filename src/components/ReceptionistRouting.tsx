import type { KnownCaller } from "@prisma/client";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { coachingRules, parseRoutingRules, prettyPhone } from "@/lib/assistant-rules";
import { addCoaching, importSuppliers, labelPendingCaller, removeCoaching, removeKnownCaller, removeOwnerPin, saveKnownCaller, saveOwnerPin, saveRoutingRules, saveUrgentCalls } from "@/app/assistant-actions";

// Every receptionist's call routing (CRM and portal): what counts as urgent and where urgent calls
// go, and the supplier and delivery list (uploaded, added by hand, or spotted on calls and
// confirmed on a check-in call). Also the owner-control pieces shared with the Assistant card and
// Grace's page: the owner's feedback rules and PIN.

type Line = {
  id: string;
  name: string;
  businessName: string;
  escalationRules: string;
  escalationPhone: string | null;
  ringFirstNumber: string | null;
  routingRules: string;
  checkinsOn: boolean;
  coaching: string;
  ownerPinHash: string | null;
  ownerPinLockedUntil: Date | null;
};

/** What the owner counts as urgent, and the number urgent calls are put through to. */
export function UrgentCallsCard({ r, returnTo }: { r: Line; returnTo: string }) {
  return (
    <form action={saveUrgentCalls.bind(null, r.id, returnTo)} className="card space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h2>Urgent calls</h2>
        {r.escalationPhone && r.escalationRules.trim() ? <Badge className="bg-emerald-100 text-emerald-800">set up</Badge> : <Badge className="bg-amber-100 text-amber-800">needs setting up</Badge>}
      </div>
      <p className="text-xs text-slate-500">When a call matches your definition, {r.name} puts it straight through to your urgent number with a press-1 screen. If nobody answers, {r.name} comes back on and takes an urgent message. Everything else is a message or a booking.</p>
      <label className="block">
        <span className="label">What counts as urgent for {r.businessName}</span>
        <textarea name="escalationRules" rows={3} maxLength={1000} defaultValue={r.escalationRules} placeholder="e.g. A customer stranded or unsafe to drive, a vehicle we worked on that's broken down, or a caller who is upset and asks for the owner." className="input" />
      </label>
      <label className="block">
        <span className="label">Put urgent calls through to</span>
        <input name="escalationPhone" type="tel" defaultValue={r.escalationPhone ?? ""} placeholder="Your cell (blank = take an urgent message instead)" className="input" />
      </label>
      <button className="btn-secondary">Save</button>
    </form>
  );
}

/** The supplier and delivery list, its rule, and callers waiting to be confirmed. */
export function SuppliersCard({ r, callers, returnTo }: { r: Line; callers: KnownCaller[]; returnTo: string }) {
  const rule = parseRoutingRules(r.routingRules).SUPPLIER;
  const suppliers = callers.filter((c) => c.status === "LABELLED" && c.category === "SUPPLIER");
  const pending = callers.filter((c) => c.status === "PENDING" && c.suggested === "SUPPLIER");
  const fallback = r.ringFirstNumber || r.escalationPhone;
  return (
    <div className="card space-y-4 text-sm">
      <h2>Suppliers and deliveries</h2>
      <p className="text-xs text-slate-500">
        When a supplier or delivery company on this list calls, {r.name} knows who they are and handles them your way instead of treating them like a customer.
        {r.checkinsOn ? ` Callers who sound like a supplier are added here to confirm, and asked about on your check-in call.` : ""}
      </p>

      <form action={saveRoutingRules.bind(null, r.id, returnTo)} className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">When they call</span>
          <select name="action_SUPPLIER" defaultValue={rule.action === "transfer" ? "transfer" : "message"} className="input w-48">
            <option value="transfer">Put them through</option>
            <option value="message">Take a message</option>
          </select>
        </label>
        <label className="flex-1">
          <span className="label">Put through to</span>
          <input name="to_SUPPLIER" type="tel" defaultValue={rule.to ?? ""} placeholder={fallback ? `Blank = ${prettyPhone(fallback)}` : "Your cell"} className="input" />
        </label>
        <button className="btn-secondary">Save</button>
      </form>

      {pending.length ? (
        <div className="space-y-2">
          <div className="label">Sounded like a supplier: confirm ({pending.length})</div>
          <ul className="divide-y divide-slate-100">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <b>{[c.company, c.name].filter(Boolean).join(", ") || "Unknown caller"}</b> <span className="text-slate-500">{prettyPhone(c.phone)}{c.lastCallAt ? ` · ${formatDate(c.lastCallAt, true)}` : ""}</span>
                  {c.note ? <div className="text-xs text-slate-600">{c.note}</div> : null}
                </div>
                <div className="flex gap-2">
                  <form action={labelPendingCaller.bind(null, r.id, c.id, returnTo)}><input type="hidden" name="category" value="SUPPLIER" /><button className="btn-secondary py-1 text-xs">Yes, a supplier</button></form>
                  <form action={labelPendingCaller.bind(null, r.id, c.id, returnTo)}><input type="hidden" name="category" value="DISMISS" /><button className="py-1 text-xs underline">No</button></form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="label">On the list ({suppliers.length})</div>
        {suppliers.length ? (
          <ul className="divide-y divide-slate-100">
            {suppliers.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <span><b>{[c.company, c.name].filter(Boolean).join(", ") || prettyPhone(c.phone)}</b> <span className="text-slate-500">{prettyPhone(c.phone)}</span></span>
                <form action={removeKnownCaller.bind(null, r.id, c.id, returnTo)}><button className="text-xs text-red-600 underline">Remove</button></form>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-500">Nobody yet. Add them below, or upload your list.</p>}
      </div>

      <details>
        <summary className="cursor-pointer text-xs underline">Add a supplier</summary>
        <form action={saveKnownCaller.bind(null, r.id, returnTo)} className="mt-2 grid grid-cols-2 gap-2">
          <input type="hidden" name="category" value="SUPPLIER" />
          <input name="company" placeholder="Company" className="input" aria-label="Company" />
          <input name="name" placeholder="Contact name" className="input" aria-label="Contact name" />
          <input name="phone" type="tel" required placeholder="Number they call from" className="input col-span-2" aria-label="Number" />
          <div className="col-span-2"><button className="btn-secondary py-1 text-xs">Add</button></div>
        </form>
      </details>

      <details>
        <summary className="cursor-pointer text-xs underline">Upload or paste a list</summary>
        <form action={importSuppliers.bind(null, r.id, returnTo)} className="mt-2 space-y-2">
          <p className="text-xs text-slate-500">A spreadsheet saved as CSV, or paste one per line: company, contact, phone number (in any order).</p>
          <input name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="block text-xs" aria-label="CSV file" />
          <textarea name="list" rows={4} placeholder={"Acme Lumber, Dave, 604-555-0101\nNAPA Auto Parts, 604-555-0102"} className="input" aria-label="Supplier list" />
          <button className="btn-secondary py-1 text-xs">Add to the list</button>
        </form>
      </details>
    </div>
  );
}

/** The owner's feedback the receptionist follows (owner controls: Assistant lines, and Grace). */
export function FeedbackSection({ r, returnTo }: { r: Pick<Line, "id" | "name" | "coaching">; returnTo: string }) {
  const rules = coachingRules(r.coaching);
  return (
    <div className="space-y-2">
      <div className="label">Feedback {r.name} follows</div>
      <p className="text-xs text-slate-500">Tell {r.name} how to handle calls differently, here or by calling or texting it (&ldquo;feedback: don&apos;t ask for an email until they&apos;ve booked&rdquo;). Each becomes a rule it follows from the next call; facts like prices belong in the knowledge base.</p>
      {rules.length ? (
        <ul className="divide-y divide-slate-100">
          {rules.map((rule, i) => (
            <li key={`${i}-${rule}`} className="flex items-start justify-between gap-2 py-1.5">
              <span>{rule}</span>
              <form action={removeCoaching.bind(null, r.id, i, returnTo)}><button className="text-xs text-red-600 underline">Remove</button></form>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-slate-500">No feedback yet.</p>}
      <form action={addCoaching.bind(null, r.id, returnTo)} className="flex gap-2">
        <input name="rule" required maxLength={240} placeholder="e.g. Keep answers to one or two sentences" className="input flex-1" aria-label="Feedback" />
        <button className="btn-secondary">Add</button>
      </form>
    </div>
  );
}

/** The owner's keypad PIN for bigger changes by phone or text. */
export function OwnerPinSection({ r, returnTo }: { r: Pick<Line, "id" | "ownerPinHash" | "ownerPinLockedUntil">; returnTo: string }) {
  const locked = r.ownerPinLockedUntil && r.ownerPinLockedUntil.getTime() > Date.now();
  return (
    <div className="space-y-2">
      <div className="label">Owner PIN {r.ownerPinHash ? <Badge className="ml-1 bg-emerald-100 text-emerald-800">set</Badge> : <Badge className="ml-1">not set</Badge>} {locked ? <Badge className="ml-1 bg-red-100 text-red-800">locked for now</Badge> : null}</div>
      <p className="text-xs text-slate-500">Bigger changes by phone or text (regular hours, prices, services, policies, routing, feedback) need this PIN, keyed in on the phone keypad or texted back. Without one, they&apos;re confirmed by replying YES to a text. 4 to 8 digits; 3 wrong tries lock it for 15 minutes.</p>
      <form action={saveOwnerPin.bind(null, r.id, returnTo)} className="flex flex-wrap gap-2">
        <input name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,8}" required placeholder={r.ownerPinHash ? "New PIN" : "PIN"} className="input w-32" aria-label="PIN" />
        <input name="pin2" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,8}" required placeholder="Again" className="input w-32" aria-label="PIN again" />
        <button className="btn-secondary">{r.ownerPinHash ? "Change PIN" : "Set PIN"}</button>
      </form>
      {r.ownerPinHash ? <form action={removeOwnerPin.bind(null, r.id, returnTo)}><button className="text-xs text-red-600 underline">Remove PIN</button></form> : null}
    </div>
  );
}

/** Grace's page: the team's dial-in controls (feedback and PIN), without the Assistant tier. */
export function OwnerControlsCard({ r, returnTo }: { r: Line; returnTo: string }) {
  return (
    <div className="card space-y-4 text-sm">
      <h2>Your dial-in controls</h2>
      <p className="text-xs text-slate-500">Call or text the main number from an admin&apos;s mobile: {r.name} offers the demo menu, and can make changes (hours, what callers are told, routing), take your feedback, or read your messages. Every change is confirmed by text; reply UNDO to reverse it.</p>
      <FeedbackSection r={r} returnTo={returnTo} />
      <OwnerPinSection r={r} returnTo={returnTo} />
    </div>
  );
}
