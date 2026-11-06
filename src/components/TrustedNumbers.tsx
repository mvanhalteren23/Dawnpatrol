import { addTrustedNumber, removeTrustedNumber } from "@/app/customer-actions";

type Row = { id: string; phone: string; label: string };

/** Numbers this line never limits (call protection): suppliers, staff, regular customers. */
export function TrustedNumbers({ receptionistId, rows, returnTo, compact = false }: { receptionistId: string; rows: Row[]; returnTo: string; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2" : "card space-y-3 text-sm"}>
      {compact ? <div className="label">Trusted numbers</div> : <h2>Trusted numbers</h2>}
      <p className="text-xs text-slate-500">Suppliers, staff and regulars who call often: they&apos;re never limited, however many times they call. Anyone who booked in the last 90 days is trusted automatically.</p>
      {rows.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-1.5">
              <span>{t.label ? <b>{t.label}</b> : null} {t.phone}</span>
              <form action={removeTrustedNumber.bind(null, receptionistId, t.id, returnTo)}><button className="text-xs underline">Remove</button></form>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={addTrustedNumber.bind(null, receptionistId, returnTo)} className="flex flex-wrap gap-2">
        <input name="label" placeholder="Who (e.g. NAPA Auto Parts)" className="input w-48 flex-1" aria-label="Who" />
        <input name="phone" type="tel" required placeholder="Number" className="input w-40" aria-label="Number" />
        <button className="btn-secondary">Add</button>
      </form>
    </div>
  );
}
