import { brandFromWebsite, createCalendarFeed, disconnectCalendar, saveEmailBranding } from "@/app/customer-actions";
import { brandedHtml, safeColor } from "@/lib/email-brand";
import type { CalendarMode } from "@/lib/booking-calendar";

type R = { id: string; name: string; businessName: string; brandLogoUrl: string | null; brandColor: string | null; emailSignOff: string; emailReplyTo: string | null; calendarFeedToken: string | null };

/**
 * The booking calendar (built-in, or the client's own Google Calendar), the phone calendar link,
 * and how emails to callers look. Shown in the client portal and on the CRM agent page.
 */
export function CalendarAndBranding({ r, mode, calendarEmail, replyTo, appUrl, returnTo, canConnect, staff, live = false, fallbackFrom = null }: { r: R; mode: CalendarMode; calendarEmail: string | null; replyTo: string | null; appUrl: string; returnTo: string; canConnect: boolean; staff: boolean; live?: boolean; fallbackFrom?: string | null }) {
  const feed = r.calendarFeedToken ? `${appUrl}/api/calendar/feed/${r.calendarFeedToken}.ics` : null;
  const sample = brandedHtml(
    { businessName: r.businessName, logoUrl: r.brandLogoUrl, color: r.brandColor, signOff: r.emailSignOff },
    `Hi Sam,\n\nYou're booked for an estimate with ${r.businessName}:\n\nWhen: Thursday, November 12 at 10:00 AM, 30 minutes\nHow: we'll call you at 604-555-0100\n\nAdd it to your calendar with the attached invite.\n\nNeed to reschedule or cancel? No problem — call us back${replyTo ? ` or email ${replyTo}` : ""}.\n\nThe ${r.businessName} team`,
  );
  return (
    <div className="card space-y-5 text-sm">
      <div className="space-y-2">
        <h2>Booking calendar</h2>
        {mode === "client" ? (
          <>
            <p>{r.name} books into <b>{calendarEmail}</b>&apos;s Google Calendar and checks it for busy times. Invites come from that calendar.</p>
            <form action={disconnectCalendar.bind(null, r.id, returnTo)}><button className="text-xs underline">Disconnect calendar</button></form>
          </>
        ) : mode === "google" ? (
          <p>{r.name} books into the Google calendar {calendarEmail ? <b>{calendarEmail}</b> : "connected in the CRM"}.</p>
        ) : (
          <p>{r.name} uses the <b>built-in calendar</b>: nothing to set up. Bookings follow {staff ? "their" : "your"} business hours, never overlap, and each customer gets a branded confirmation with an &ldquo;add to calendar&rdquo; invite.</p>
        )}
        {fallbackFrom ? (
          <div className="rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            The connection to {fallbackFrom}&apos;s Google Calendar stopped working (it may have been removed in Google). Bookings are safely using the built-in calendar meanwhile. Reconnect to go back to {staff ? "their" : "your"} Google Calendar.
          </div>
        ) : null}
        {canConnect && mode !== "client" ? (
          <div className="rounded-[10px] bg-dawn-50 p-3">
            <p className="mb-2 text-xs text-slate-600">{live ? <><b>Recommended:</b> connect {staff ? "their" : "your"} Google Calendar so {staff ? "their" : "your"} own appointments block bookings and invites come from {staff ? "their" : "your"} calendar. About 30 seconds.</> : "Use Google Calendar? Connect it so your own appointments block bookings and invites come from your calendar. About 30 seconds."}</p>
            <a href={`/api/google/calendar/connect?r=${r.id}`} className="btn-secondary inline-flex">{fallbackFrom ? "Reconnect Google Calendar" : "Connect Google Calendar"}</a>
            <p className="mt-2 text-xs text-slate-500">We only check when you&apos;re busy and add the appointments we book; you can disconnect any time. <a href="/google-calendar" target="_blank" rel="noreferrer">How it works</a> · <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></p>
            {staff ? <p className="mt-2 text-xs text-slate-500">{live ? "Best done by the client in their portal (Your setup), signed in with their own Google account." : "Clients don't see this yet: it's switched on for them in Settings once Google approves the calendar app. Until then the built-in calendar is the default."}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-4">
        <h2>Bookings on {staff ? "the owner's" : "your"} phone</h2>
        {feed ? (
          <>
            <p className="text-xs text-slate-600">Add this private link to {staff ? "their" : "your"} phone&apos;s calendar and every booking shows up there automatically. iPhone: tap the link below. Google Calendar: Settings → Add calendar → From URL, then paste it.</p>
            <a href={feed.replace(/^https:/, "webcal:")} className="btn-secondary inline-flex">Add to my phone&apos;s calendar</a>
            <input readOnly value={feed} className="input py-1 text-xs" aria-label="Calendar link" />
            <p className="text-xs text-slate-500">Keep it private: anyone with the link can see bookings. Make a new one to turn the old link off.</p>
            <form action={createCalendarFeed.bind(null, r.id, returnTo)}><button className="text-xs underline">Make a new link</button></form>
          </>
        ) : (
          <form action={createCalendarFeed.bind(null, r.id, returnTo)}><button className="btn-secondary">Get {staff ? "the" : "my"} calendar link</button></form>
        )}
      </div>

      <form action={saveEmailBranding.bind(null, r.id, returnTo)} className="space-y-3 border-t border-slate-100 pt-4">
        <h2>How emails to customers look</h2>
        <p className="text-xs text-slate-600">Booking confirmations and call summaries go out as <b>{r.businessName}</b>, in {staff ? "their" : "your"} colours, and replies go to {replyTo ? <b>{replyTo}</b> : "the email below"}.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">Logo (https link to a PNG or JPG; email apps don&apos;t show SVG)<input name="brandLogoUrl" defaultValue={r.brandLogoUrl ?? ""} placeholder="https://…/logo.png" className="input mt-1" /></label>
          <label className="block">Brand colour<input name="brandColor" defaultValue={r.brandColor ?? ""} placeholder="#1F3B2D" className="input mt-1" style={{ borderLeft: `14px solid ${safeColor(r.brandColor)}` }} /></label>
          <label className="block">Replies go to<input name="emailReplyTo" type="email" defaultValue={r.emailReplyTo ?? ""} placeholder={replyTo ?? "you@yourbusiness.ca"} className="input mt-1" /></label>
          <label className="block">Sign-off (optional)<textarea name="emailSignOff" rows={2} defaultValue={r.emailSignOff} placeholder={"Dana Smith\nCoast Plumbing · 604-555-0100"} className="input mt-1" /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn">Save</button>
          <button formAction={brandFromWebsite.bind(null, r.id, returnTo)} className="btn-secondary">Get logo &amp; colour from website</button>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-dawn-600">Preview a booking confirmation</summary>
          <iframe title="Email preview" srcDoc={sample} sandbox="" className="mt-2 h-[460px] w-full rounded-[10px] border border-slate-200" />
        </details>
      </form>
    </div>
  );
}
