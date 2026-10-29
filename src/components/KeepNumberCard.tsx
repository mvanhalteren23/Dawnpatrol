import type { Receptionist } from "@prisma/client";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CARRIERS, formatNumber, forwardingSteps, KEEP_METHODS, PORT_CHECKLIST, PORT_STATUSES, type KeepMethod } from "@/lib/keep-number";
import { formatDate } from "@/lib/utils";
import { saveKeepNumber } from "@/app/receptionist-actions";

type R = Pick<Receptionist, "id" | "businessNumber" | "existingNumber" | "existingCarrier" | "keepNumberMethod" | "portStatus" | "portDate" | "portNotes" | "ringSeconds">;

/**
 * Keep the business's existing number: forward it to the receptionist line, or move it to us.
 * Used in the client portal and on the CRM receptionist page (admins also update port progress).
 */
export function KeepNumberCard({ r, returnTo, admin, editable = true }: { r: R; returnTo: string; admin: boolean; editable?: boolean }) {
  const method = r.keepNumberMethod as KeepMethod;
  const target = r.businessNumber;
  const steps = target && r.existingNumber ? forwardingSteps(r.existingCarrier, method, target, r.ringSeconds) : [];
  const status = PORT_STATUSES.find((s) => s.value === r.portStatus)?.label ?? "Not started";

  return (
    <div className="card space-y-4 text-sm">
      <div>
        <h2>Keep your existing number</h2>
        <p className="text-xs text-slate-500">
          Customers keep calling the number on your truck, website and Google listing.{" "}
          {target ? <>Your receptionist line is <b>{formatNumber(target)}</b>.</> : "Your receptionist line is set up first; then the number you already have can point to it."}
        </p>
      </div>

      {!editable ? (
        <p className="text-sm">
          {method
            ? <>{r.existingNumber ? <b>{formatNumber(r.existingNumber)}</b> : "Your number"}: {KEEP_METHODS.find((m) => m.value === method)?.label.replace(" (recommended)", "").toLowerCase()}.</>
            : "Not set up yet. Request a change if you'd like customers to keep calling your current number."}
        </p>
      ) : (
      <form action={saveKeepNumber.bind(null, r.id, returnTo)} className="grid grid-cols-2 gap-3">
        <Field label="Number your customers call"><input name="existingNumber" defaultValue={r.existingNumber ?? ""} placeholder="604-555-1234" className="input" inputMode="tel" /></Field>
        <Field label="Its phone company">
          <select name="existingCarrier" defaultValue={r.existingCarrier ?? ""} className="input">
            <option value="">Choose…</option>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <fieldset className="col-span-2 space-y-2">
          <legend className="label">How</legend>
          {KEEP_METHODS.map((m) => (
            <label key={m.value} className="flex items-start gap-2">
              <input type="radio" name="keepNumberMethod" value={m.value} defaultChecked={method === m.value} className="mt-1" />
              <span><b>{m.label}</b><span className="block text-xs text-slate-500">{m.summary}</span></span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-xs text-slate-500">
            <input type="radio" name="keepNumberMethod" value="" defaultChecked={!method} className="mt-0.5" /> Not now (customers call the receptionist line directly)
          </label>
        </fieldset>
        {admin && method === "port" ? (
          <>
            <Field label="Move progress">
              <select name="portStatus" defaultValue={r.portStatus} className="input">{PORT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            </Field>
            <Field label="Port date"><input name="portDate" type="date" defaultValue={r.portDate?.toISOString().slice(0, 10) ?? ""} className="input" /></Field>
            <Field label="Notes (Twilio port request, carrier, PIN received…)" className="col-span-2"><textarea name="portNotes" rows={2} defaultValue={r.portNotes} className="input" /></Field>
          </>
        ) : null}
        <div className="col-span-2"><SubmitButton className="btn-secondary" pendingText="Saving…">Save</SubmitButton></div>
      </form>
      )}

      {(method === "forward_no_answer" || method === "forward_all") && r.existingNumber ? (
        <div className="space-y-2 rounded-lg bg-dawn-50 p-3">
          <div className="font-medium">Turn on forwarding from {formatNumber(r.existingNumber)}</div>
          {!target ? <p className="text-xs">Steps appear once your receptionist line is set up.</p> : (
            <ol className="list-decimal space-y-2 pl-5">
              {steps.map((s, i) => (
                <li key={i}>
                  {s.text}
                  {s.code ? <code className="mt-1 block w-fit select-all rounded bg-white px-2 py-1 font-mono text-sm">{s.code}</code> : null}
                </li>
              ))}
              <li>Test it: from another phone, call {formatNumber(r.existingNumber)}{method === "forward_no_answer" ? " and let it ring out" : ""}. The receptionist should answer.</li>
            </ol>
          )}
          <p className="text-xs text-slate-500">Texts to your existing number still go to your phone; only calls are forwarded. Some plans charge for forwarded minutes, so check with your phone company if you&apos;re unsure.</p>
        </div>
      ) : null}

      {method === "port" ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">Moving {r.existingNumber ? formatNumber(r.existingNumber) : "your number"}</span>
            <span className="text-xs">Status: <b>{status}</b>{r.portDate ? ` · ${formatDate(r.portDate)}` : ""}</span>
          </div>
          <p className="text-xs text-slate-500">What we need from you:</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">{PORT_CHECKLIST.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="text-xs text-slate-500">Until the move is done, you can forward missed calls (above) so nothing is lost in the meantime.</p>
          {admin ? (
            <p className="border-t border-slate-200 pt-2 text-xs text-slate-600">
              Admin: submit the port in the Twilio Console (Phone Numbers → Port &amp; Host → Port a number) with the bill and signed authorization. When it completes, remove the current business line (tick release if the temporary number isn&apos;t needed any more), use <b>Get business line</b> with the moved number under &ldquo;use a number already on Twilio&rdquo;, then mark this Done.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
