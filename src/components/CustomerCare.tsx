import type { Booking, OpenQuestion, Receptionist } from "@prisma/client";
import { formatDate } from "@/lib/utils";
import { formatSlot } from "@/lib/booking";
import { answerOpenQuestion, dismissOpenQuestion, markBookingNoShow, saveCustomerTextSettings } from "@/app/customer-actions";
import { Badge, Empty } from "./ui";

// Customer texts, bookings and open questions (shared by the CRM receptionist page and the portal).

type R = Pick<Receptionist, "id" | "name" | "rescueTextsOn" | "smsAgentOn" | "recognizeCallers" | "photoTextsOn" | "remindersOn" | "reviewRequestsOn" | "reviewLink" | "reviewDelayHours" | "checkinsOn" | "checkinThreshold" | "checkinPhone" | "ringFirstNumber" | "businessNumber" | "bookingEnabled">;

const Toggle = ({ name, on, label, help }: { name: string; on: boolean; label: string; help: string }) => (
  <label className="flex items-start gap-2">
    <input type="checkbox" name={name} defaultChecked={on} className="mt-1" />
    <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{help}</span></span>
  </label>
);

export function CustomerTextSettings({ r, returnTo, bookingLink }: { r: R; returnTo: string; bookingLink: string | null }) {
  return (
    <form action={saveCustomerTextSettings.bind(null, r.id, returnTo)} className="card space-y-3 text-sm">
      <h2>Texts, reminders and check-ins</h2>
      {!r.businessNumber ? <p className="text-xs text-slate-500">Texts go out from our shared number until you have your own business line.</p> : null}
      <Toggle name="rescueTextsOn" on={r.rescueTextsOn} label="Text a booking link after missed opportunities" help="When a caller hangs up or leaves a message without booking, they get a text within a minute with a link to pick a time." />
      <Toggle name="smsAgentOn" on={r.smsAgentOn} label={`${r.name} answers customers' texts`} help="Customers who text your line get answers from your knowledge base and the booking link. Anything that needs you is sent to your phone." />
      <Toggle name="photoTextsOn" on={r.photoTextsOn} label="Accept photos customers text" help="Customers can text photos of the job (a leak, damage, the space). You get a text with a link to see them; photos are deleted after 60 days." />
      <Toggle name="recognizeCallers" on={r.recognizeCallers} label="Recognise returning callers" help={`${r.name} can greet someone by first name and ask about their upcoming appointment, based on their phone number and your own booking and call records. It only confirms, and never reads details out.`} />
      <Toggle name="remindersOn" on={r.remindersOn} label="Appointment reminders and no-show rebooking" help="A text the day before (reply C to confirm, R to reschedule). Mark a no-show and they get a link to rebook." />
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <Toggle name="reviewRequestsOn" on={r.reviewRequestsOn} label="Ask for a Google review after appointments" help="Every customer gets your review link (Google doesn't allow asking only happy customers). Replies come to you." />
        <input name="reviewLink" defaultValue={r.reviewLink} placeholder="https://g.page/r/... (Google Business Profile → Ask for reviews)" className="input" />
        <label className="flex items-center gap-2 text-xs text-slate-600">Send it <input name="reviewDelayHours" type="number" min={1} max={48} defaultValue={r.reviewDelayHours} className="input w-16 py-1" /> hours after the appointment ends</label>
      </div>
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <Toggle name="checkinsOn" on={r.checkinsOn} label="Weekly check-in call about callers' questions" help="When callers ask things it can't answer, or a holiday is coming up, we call you (at most once a week, weekdays 10–4) so it learns the answers." />
        <label className="flex items-center gap-2 text-xs text-slate-600">Call once
          <select name="checkinThreshold" defaultValue={String(r.checkinThreshold)} className="input w-16 py-1">{[3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
          questions are waiting (holidays are asked about anyway)</label>
        <input name="checkinPhone" defaultValue={r.checkinPhone ?? ""} placeholder={r.ringFirstNumber ? `Number to call (blank = ${r.ringFirstNumber})` : "Number to call for check-ins"} className="input" />
      </div>
      {bookingLink ? <p className="text-xs text-slate-600">Your booking link: <a href={bookingLink} target="_blank" rel="noreferrer" className="break-all">{bookingLink}</a> (add it to your website or Google profile too)</p> : r.bookingEnabled ? null : <p className="text-xs text-slate-500">Booking links need online booking turned on.</p>}
      <button className="btn-secondary">Save</button>
    </form>
  );
}

const STATUS: Record<string, string> = { BOOKED: "booked", CONFIRMED: "confirmed", RESCHEDULE_REQUESTED: "wants to reschedule", CANCELLED: "moved/cancelled", NO_SHOW: "no-show" };

export function BookingsList({ r, bookings, returnTo, timezone }: { r: Pick<Receptionist, "id">; bookings: Booking[]; returnTo: string; timezone: string }) {
  const now = Date.now();
  return (
    <div className="card">
      <h2 className="mb-3">Bookings</h2>
      {bookings.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="font-medium">{b.customerName} <span className="font-normal text-slate-500">{b.customerPhone ?? ""}</span></div>
                <div className="text-xs text-slate-500">{formatSlot(b.start, timezone)} · {b.title}{b.source === "link" ? " · booked online" : ""}{b.reminderSentAt ? " · reminded" : ""}{b.reviewAskedAt ? " · review asked" : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={b.status === "NO_SHOW" || b.status === "RESCHEDULE_REQUESTED" ? "bg-amber-100 text-amber-800" : b.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-800" : ""}>{STATUS[b.status] ?? b.status}</Badge>
                {["BOOKED", "CONFIRMED"].includes(b.status) && b.start.getTime() < now ? (
                  <form action={markBookingNoShow.bind(null, r.id, b.id, returnTo)}><button className="btn-secondary px-2 py-1 text-xs" title="They didn't show: text them a link to rebook">No-show</button></form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty>No bookings yet. Appointments your receptionist books show up here.</Empty>}
    </div>
  );
}

export function OpenQuestions({ r, questions, returnTo }: { r: Pick<Receptionist, "id" | "name">; questions: OpenQuestion[]; returnTo: string }) {
  if (!questions.length) return null;
  return (
    <div className="card space-y-3">
      <div>
        <h2>Questions callers asked</h2>
        <p className="text-xs text-slate-500">{r.name} couldn&apos;t answer these. Answer here and it uses the answer right away; otherwise we&apos;ll ask you on your weekly check-in.</p>
      </div>
      <ul className="space-y-3">
        {questions.map((q) => (
          <li key={q.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="font-medium">{q.question}</div>
            <div className="text-xs text-slate-500">{q.kind === "holiday" ? "Upcoming holiday" : `Asked by ${q.askedCount} caller${q.askedCount === 1 ? "" : "s"} · since ${formatDate(q.createdAt)}`}</div>
            <form action={answerOpenQuestion.bind(null, r.id, q.id, returnTo)} className="mt-2 flex gap-2">
              <input name="answer" required maxLength={2000} placeholder={q.kind === "holiday" ? "e.g. Closed, or open 9 to 1" : "Your answer"} className="input" />
              <button className="btn-secondary whitespace-nowrap">Save</button>
            </form>
            <form action={dismissOpenQuestion.bind(null, r.id, q.id, returnTo)} className="mt-1"><button className="text-xs text-slate-400 hover:text-slate-600">Not relevant</button></form>
          </li>
        ))}
      </ul>
    </div>
  );
}
