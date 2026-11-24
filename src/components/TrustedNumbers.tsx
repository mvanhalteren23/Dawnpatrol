import { db } from "@/lib/db";
import { addTrustedNumber, importKnownCallers, removeImportedCallers, removeTrustedNumber, updateKnownCaller } from "@/app/customer-actions";
import { HANDLING_LABEL, HANDLING_TAG, HANDLINGS, IMPORT_MAX_ROWS, parseHandling } from "@/lib/known-caller-rules";

const SHOWN = 200;

/**
 * Known callers: numbers this line knows, with a name, a note for the receptionist and how to handle
 * them (VIP, put through, supplier, don't book). The client's customer list can be imported so
 * regulars are greeted by name from day one. Known callers are never limited by call protection
 * (except "don't book"). Shared by the CRM and the client portal.
 */
export async function TrustedNumbers({ receptionistId, returnTo, compact = false }: { receptionistId: string; returnTo: string; compact?: boolean }) {
  // Tagged, noted and hand-added numbers are listed; an imported list can be thousands, so it's counted.
  const [rows, imported, total] = await Promise.all([
    db.trustedNumber.findMany({
      where: { receptionistId, OR: [{ source: { not: "import" } }, { handling: { not: "normal" } }, { notes: { not: "" } }] },
      orderBy: [{ updatedAt: "desc" }],
      take: SHOWN,
    }),
    db.trustedNumber.count({ where: { receptionistId, source: "import" } }),
    db.trustedNumber.count({ where: { receptionistId } }),
  ]);
  const handlingSelect = (value: string) => (
    <select name="handling" defaultValue={parseHandling(value)} className="input w-auto py-1 text-xs" aria-label="How to handle calls from this number">
      {HANDLINGS.map((h) => <option key={h} value={h}>{HANDLING_LABEL[h]}</option>)}
    </select>
  );
  return (
    <div className={compact ? "space-y-3" : "card space-y-3 text-sm"}>
      {compact ? <div className="label">Known callers</div> : <h2>Known callers</h2>}
      <p className="text-xs text-slate-500">
        Customers, suppliers and staff the receptionist should know. It greets them by name (it only confirms: &ldquo;Is this Dave?&rdquo;),
        follows the note and handling you set, and tells callers whether their last message was followed up. Known callers are never
        limited by call protection, except &ldquo;Don&apos;t book&rdquo;. &ldquo;Always put through&rdquo; and suppliers ring your phone first at any hour,
        when ring-first has a number set. Anyone who booked in the last 90 days is also never limited.
      </p>

      {rows.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((t) => {
            const tag = HANDLING_TAG[parseHandling(t.handling)];
            return (
              <li key={t.id} className="py-2">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span>
                      {t.label ? <b>{t.label}</b> : t.firstName ? <b>{t.firstName}</b> : null} {t.phone}
                      {tag ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{tag}</span> : null}
                      {t.notes ? <span className="block text-xs text-slate-500">{t.notes}</span> : null}
                    </span>
                    <span className="text-xs underline">Edit</span>
                  </summary>
                  <form action={updateKnownCaller.bind(null, receptionistId, t.id, returnTo)} className="mt-2 flex flex-wrap items-center gap-2">
                    <input name="label" defaultValue={t.label} placeholder="Who" className="input w-40 py-1 text-xs" aria-label="Who" />
                    <input name="firstName" defaultValue={t.firstName} placeholder="First name" className="input w-28 py-1 text-xs" aria-label="First name" />
                    {handlingSelect(t.handling)}
                    <input name="notes" defaultValue={t.notes} maxLength={140} placeholder="Note for the receptionist" className="input w-full py-1 text-xs" aria-label="Note for the receptionist" />
                    <button className="btn-secondary py-1 text-xs">Save</button>
                    <button formAction={removeTrustedNumber.bind(null, receptionistId, t.id, returnTo)} className="text-xs underline">Remove</button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      ) : null}
      {total > rows.length ? <p className="text-xs text-slate-500">{total - rows.length} more number{total - rows.length === 1 ? "" : "s"} from your customer list (not shown). To tag one, add it below: it updates the same entry.</p> : null}

      <form action={addTrustedNumber.bind(null, receptionistId, returnTo)} className="space-y-2 rounded-lg bg-slate-50 p-3">
        <div className="text-xs font-semibold">Add or update a number</div>
        <div className="flex flex-wrap gap-2">
          <input name="label" placeholder="Who (e.g. Dave, property manager)" className="input w-48 flex-1" aria-label="Who" />
          <input name="phone" type="tel" required placeholder="Number" className="input w-36" aria-label="Number" />
          {handlingSelect("normal")}
        </div>
        <input name="notes" maxLength={140} placeholder="Note for the receptionist (optional), e.g. manages 12 rentals, always wants a quote first" className="input w-full" aria-label="Note for the receptionist" />
        <button className="btn-secondary">Save number</button>
      </form>

      <form action={importKnownCallers.bind(null, receptionistId, returnTo)} className="space-y-2 rounded-lg bg-slate-50 p-3">
        <div className="text-xs font-semibold">Import your customer list</div>
        <p className="text-xs text-slate-500">
          A CSV with a Phone column (and Name, or First/Last name; Company, Notes and Tag are used if present: tags like VIP, supplier, put through or
          don&apos;t book). Export it from Jobber, Housecall Pro, QuickBooks, Google Contacts or a spreadsheet. Up to {IMPORT_MAX_ROWS.toLocaleString("en-US")} rows;
          numbers already here keep their tags and notes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input name="file" type="file" accept=".csv,text/csv" required className="text-xs" aria-label="Customer list (CSV)" />
          <button className="btn-secondary">Import</button>
        </div>
      </form>
      {imported ? (
        <form action={removeImportedCallers.bind(null, receptionistId, returnTo)} className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>{imported.toLocaleString("en-US")} number{imported === 1 ? "" : "s"} imported from a customer list.</span>
          <button className="underline">Remove the imported list</button>
        </form>
      ) : null}
    </div>
  );
}
