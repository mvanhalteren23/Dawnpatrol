import type { Receptionist } from "@prisma/client";
import { hoursByDay, WEEK_ORDER } from "@/lib/booking";
import { Field } from "@/components/ui";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Bookable hours (one row per weekday), holidays and closed dates. Parsed by availabilityFromForm. */
export function AvailabilityFields({ r }: { r: Pick<Receptionist, "bookingHours" | "bookingHolidays" | "bookingClosedDates" | "timezone"> }) {
  const days = hoursByDay(r.bookingHours);
  return (
    <>
      <div className="col-span-2">
        <div className="label">Bookable hours ({r.timezone.replace("_", " ")}) — leave a day blank if closed</div>
        <div className="mt-1 grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-1">
          {WEEK_ORDER.map((d) => (
            <div key={d} className="contents">
              <label htmlFor={`hours_${d}`} className="text-sm text-slate-600">{DAY_NAMES[d]}</label>
              <input id={`hours_${d}`} name={`hours_${d}`} defaultValue={days[d]} placeholder="Closed" className="input font-mono text-xs" />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">e.g. <code>09:00-17:00</code>, or with a lunch break <code>09:00-12:00, 13:00-17:00</code></p>
      </div>
      <Field label="Holidays">
        <select name="bookingHolidays" defaultValue={r.bookingHolidays} className="input">
          <option value="">Book on holidays</option>
          <option value="CA-BC">Closed on B.C. statutory holidays</option>
        </select>
      </Field>
      <Field label="Other closed days (YYYY-MM-DD, one per line)"><textarea name="bookingClosedDates" rows={2} defaultValue={r.bookingClosedDates} placeholder="2026-12-24" className="input font-mono text-xs" /></Field>
    </>
  );
}

/** After-call / after-booking summary options. Parsed by followUpFromForm. */
export function FollowUpFields({ r }: { r: Pick<Receptionist, "followUpOn" | "followUpChannel"> }) {
  return (
    <>
      <Field label="Send the caller a summary">
        <select name="followUpOn" defaultValue={r.followUpOn} className="input">
          <option value="">Never</option>
          <option value="bookings">After a booking (confirmation)</option>
          <option value="calls">After every call</option>
          <option value="both">After bookings and calls</option>
        </select>
      </Field>
      <Field label="By">
        <select name="followUpChannel" defaultValue={r.followUpChannel} className="input">
          <option value="caller_choice">Text or email — the caller chooses</option>
          <option value="sms">Text message</option>
          <option value="email">Email</option>
        </select>
      </Field>
      <p className="col-span-2 text-xs text-slate-500">The receptionist offers it on the call, and callers can say no. Call summaries are written by Claude from the call and only state what was said. Spam calls never get one.</p>
    </>
  );
}

/** Texts to the owner about new leads. Parsed by leadAlertFromForm. */
export function LeadAlertFields({ r }: { r: Pick<Receptionist, "leadAlertOn" | "leadAlertTo" | "ringFirstNumber" | "businessNumber"> }) {
  return (
    <>
      <Field label="Text me about new leads">
        <select name="leadAlertOn" defaultValue={r.leadAlertOn} className="input">
          <option value="">Off</option>
          <option value="messages">Calls that need a call back</option>
          <option value="leads">Every lead (also bookings and transfers)</option>
        </select>
      </Field>
      <Field label="Text these numbers (comma separated)"><input name="leadAlertTo" defaultValue={r.leadAlertTo} placeholder={r.ringFirstNumber ?? "604-555-1234"} className="input" inputMode="tel" /></Field>
      <p className="col-span-2 text-xs text-slate-500">
        A short text with who called, what they need and their number, straight after the call.
        {r.businessNumber ? " Reply 1 to mark the lead handled." : ""} Blank sends to the cell that rings first.
      </p>
    </>
  );
}

/** Emailed call reports (totals only). Parsed by reportFromForm. */
export function ReportFields({ r }: { r: Pick<Receptionist, "reportFrequency" | "reportEmails"> }) {
  return (
    <>
      <Field label="Email me a call report">
        <select name="reportFrequency" defaultValue={r.reportFrequency} className="input">
          <option value="">Never (view it in the portal)</option>
          <option value="weekly">Every Monday (last week)</option>
          <option value="monthly">On the 1st (last month)</option>
          <option value="both">Weekly and monthly</option>
        </select>
      </Field>
      <Field label="Send to (blank = your portal login)"><input name="reportEmails" defaultValue={r.reportEmails} placeholder="owner@business.com, office@business.com" className="input" /></Field>
      <p className="col-span-2 text-xs text-slate-500">Reports show totals only: calls answered, after-hours calls, bookings, messages and transfers. Callers&apos; names, numbers and conversations stay here in your portal.</p>
    </>
  );
}

/** Ring-the-owner-first settings for a business line. Parsed by ringFromForm. */
export function RingFields({ r }: { r: Pick<Receptionist, "ringFirstNumber" | "ringSeconds" | "ringMode" | "businessNumber"> }) {
  return (
    <>
      <Field label="Ring this cell first"><input name="ringFirstNumber" defaultValue={r.ringFirstNumber ?? ""} placeholder="604-555-1234" className="input" inputMode="tel" /></Field>
      <Field label="Ring for (seconds)"><input name="ringSeconds" type="number" min={10} max={40} defaultValue={r.ringSeconds} className="input" /></Field>
      <Field label="When" className="col-span-2">
        <select name="ringMode" defaultValue={r.ringMode} className="input">
          <option value="hours">During business hours; after hours the receptionist answers right away</option>
          <option value="always">Always ring my cell first</option>
          <option value="never">Never — the receptionist answers every call</option>
        </select>
      </Field>
      <p className="col-span-2 text-xs text-slate-500">
        {r.businessNumber ? <>Calls to <b>{r.businessNumber}</b> ring your cell first. </> : null}
        When you pick up you&apos;ll hear &ldquo;press 1 to answer&rdquo;. Don&apos;t answer, decline, or just hang up, and your receptionist takes the call. Texts to the business number are forwarded to your cell. Keep the ring time shorter than it takes your cell to go to voicemail (usually 20–25 seconds).
      </p>
    </>
  );
}
