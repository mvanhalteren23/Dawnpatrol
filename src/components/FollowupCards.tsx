import type { Receptionist } from "@prisma/client";
import { DEFAULT_CALL_HOURS, followupOpening } from "@/lib/followup-rules";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { rotateLeadFormKey, saveFollowupSettings, sendTestLead } from "@/app/crm/actions";

/** Follow-up agent: what it's for, what it asks, the business's rules, when it may call. */
export function FollowupSettingsCard({ r }: { r: Receptionist }) {
  return (
    <form action={saveFollowupSettings.bind(null, r.id)} className="card grid grid-cols-2 gap-3">
      <h2 className="col-span-2">Follow-up agent</h2>
      <p className="col-span-2 text-xs text-slate-500">When someone fills in the website form, {r.name} calls them within minutes, learns what they need and books the next step. These settings plus the knowledge base are everything it knows: keep them to what {r.businessName} actually offers.</p>
      <Field label="Goal of each call" className="col-span-2">
        <input name="followupGoal" defaultValue={r.followupGoal} placeholder="Book a free on-site visit so we can quote the job." className="input" />
      </Field>
      <Field label="Opening line" className="col-span-2">
        <input name="greeting" defaultValue={r.greeting} placeholder={followupOpening({ ...r, greeting: "" })} className="input" />
      </Field>
      <Field label="Questions to cover (one per line)" className="col-span-2">
        <textarea name="followupQuestions" rows={4} defaultValue={r.followupQuestions} placeholder={"Interior, exterior or both?\nRoughly how many rooms or square feet?\nWhat's the address?\nWhen would you like it done?"} className="input" />
      </Field>
      <Field label="Rules and guardrails (one per line)" className="col-span-2">
        <textarea name="followupGuardrails" rows={4} defaultValue={r.followupGuardrails} placeholder={"We only serve Vancouver, Burnaby and North Shore.\nWe don't do commercial jobs over 3 storeys.\nNever give a price on the phone: quotes are after the site visit."} className="input" />
      </Field>
      <Field label="Calling hours (business's time zone)" className="col-span-2">
        <textarea name="followupCallHours" rows={2} defaultValue={r.followupCallHours || DEFAULT_CALL_HOURS} className="input font-mono text-xs" />
      </Field>
      <Field label="Wait before calling (seconds)"><input name="followupDelaySeconds" type="number" min={0} max={240} defaultValue={r.followupDelaySeconds} className="input" /></Field>
      <Field label="Call attempts"><input name="followupMaxAttempts" type="number" min={1} max={3} defaultValue={r.followupMaxAttempts} className="input" /></Field>
      <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="followupTextIfMissed" defaultChecked={r.followupTextIfMissed} /> Text the lead if nobody answers (needs a business line)</label>
      <p className="col-span-2 text-xs text-slate-500">Leads outside calling hours are called when they open. Booking uses the calendar settings below; without a calendar it collects preferred times and the team confirms.</p>
      <div className="col-span-2"><SubmitButton pendingText="Saving…">Save follow-up settings</SubmitButton></div>
    </form>
  );
}

/** How the client's website sends leads here, and a test lead. */
export function WebsiteFormCard({ r, app, isAdmin }: { r: Receptionist; app: string; isAdmin: boolean }) {
  const endpoint = `${app}/api/leads/${r.leadFormKey ?? "…"}`;
  const snippet = `<form action="${endpoint}" method="post">
  <input name="name" placeholder="Your name" required>
  <input name="phone" type="tel" placeholder="Phone" required>
  <input name="email" type="email" placeholder="Email">
  <textarea name="message" placeholder="What can we help with?"></textarea>
  <label><input type="checkbox" name="consent" value="yes" required>
    OK for ${r.businessName} to call or text me about my request. Calls may use an AI assistant.</label>
  <input name="website_url" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <!-- optional: <input type="hidden" name="redirect" value="https://their-site.com/thank-you"> -->
  <button>Send</button>
</form>`;
  return (
    <div className="card space-y-3 text-sm">
      <h2>Website form</h2>
      {!r.leadFormKey ? <p className="text-red-600">No form address yet.</p> : (
        <>
          <div><div className="label">Form address (POST)</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{endpoint}</code></div>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-600">HTML form to paste into their site</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{snippet}</pre>
          </details>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Their existing form (Wix, WordPress, Squarespace, Zapier, Make)</summary>
            <p className="mt-2 text-xs text-slate-600">Send each submission to the address above as a webhook (JSON or form fields). Field names are matched automatically: name / first &amp; last name, phone, email, and message or any longer answer. Make sure the form says they agree to be called back; submissions from connected forms are treated as consented.</p>
          </details>
          {isAdmin ? <form action={rotateLeadFormKey.bind(null, r.id)}><button className="text-xs text-red-600">New form address (the old one stops working)</button></form> : null}
        </>
      )}
      <form action={sendTestLead.bind(null, r.id)} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
        <div className="col-span-2 label">Test it: {r.name} calls this number now</div>
        <input name="name" placeholder="Your name" className="input" />
        <input name="phone" type="tel" placeholder="Your cell" className="input" required />
        <input name="message" placeholder="I'd like a quote to paint 3 bedrooms" className="input col-span-2" />
        <div className="col-span-2"><SubmitButton className="btn-secondary" pendingText="Calling…">Send test lead</SubmitButton></div>
      </form>
    </div>
  );
}
