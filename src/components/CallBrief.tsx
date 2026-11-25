import type { CallBrief as Brief } from "@/lib/call-brief-rules";

/**
 * What's on screen while a number is ringing or live (and during the gap before the next call):
 * who, which company, why they'd want a receptionist, and the notes. Big and readable on a phone.
 */
export function CallBrief({ brief, status, number, accountId }: { brief: Brief; status: string; number?: string | null; accountId: string }) {
  return (
    <section className="space-y-4 rounded-xl border-2 border-dawn-300 bg-white p-4 md:p-5" aria-live="polite">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-dawn-500">{status}</div>
        <h3 className="mt-1 text-2xl font-bold leading-tight text-slate-900 md:text-3xl">{brief.person ?? brief.company}</h3>
        {brief.person ? <div className="text-lg font-semibold text-slate-700">{brief.company}</div> : null}
        <div className="mt-1 text-sm text-slate-600">
          {[brief.about, number, brief.website].filter(Boolean).join(" · ")}
        </div>
      </div>

      {brief.opener ? (
        <div className="rounded-lg bg-dawn-50 p-3 text-base text-slate-800">
          <div className="label">Opener</div>
          &ldquo;{brief.opener}&rdquo;
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">Why they&apos;d want a receptionist</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-slate-800">{brief.why.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
        <div>
          <div className="label">Notes</div>
          {brief.notes.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-slate-800">{brief.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          ) : <p className="mt-1 text-sm text-slate-500">No notes yet.</p>}
        </div>
      </div>

      {brief.facts.length || brief.last ? (
        <div className="grid gap-4 border-t border-slate-100 pt-3 md:grid-cols-2">
          {brief.facts.length ? (
            <div>
              <div className="label">About the business</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{brief.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ) : null}
          {brief.last ? (
            <div>
              <div className="label">Last contact</div>
              <p className="mt-1 text-sm text-slate-700">{brief.last}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <a href={`/crm/accounts/${accountId}`} target="_blank" rel="noopener" className="inline-block text-sm">Open the full account ↗</a>
    </section>
  );
}
