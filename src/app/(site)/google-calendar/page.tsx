import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Google Calendar Connection | Head Above Digital",
  description: "What happens when you connect your Google Calendar to your Head Above Digital AI receptionist: what we access, why, and how to disconnect.",
  alternates: { canonical: "/google-calendar" },
};

export default function GoogleCalendarConnection() {
  return (
    <LegalPage
      title="Google Calendar connection"
      updated="November 6, 2026"
      intro={<p>Head Above Digital clients can connect their Google Calendar so their AI receptionist books appointments straight into it. It&apos;s optional: without it, bookings use our built-in calendar.</p>}
    >
      <h2>What it does</h2>
      <ul>
        <li>When a customer calls and wants an appointment, your receptionist checks when you&apos;re free and offers those times.</li>
        <li>When they pick one, the appointment goes into your Google Calendar and Google sends the customer the invitation from your calendar.</li>
        <li>If the appointment is rescheduled or cancelled, your receptionist updates or removes the event it created.</li>
      </ul>

      <h2>What we access, and why</h2>
      <ul>
        <li><b>Your free/busy times</b> (Google&apos;s calendar availability permission): so your receptionist never offers a time you&apos;re already busy. We see only that a time is busy, not what the event is.</li>
        <li><b>Events on your calendars</b> (Google&apos;s permission to view and edit calendar events): so your receptionist can add the appointments it books, and change or remove them when a customer reschedules or cancels. We don&apos;t read, change or delete any other events.</li>
        <li><b>Your Google account email</b>: so your portal shows which calendar is connected.</li>
      </ul>
      <p>We never sell this data, use it for advertising, or use it to train AI models. Head Above Digital&apos;s use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Details are in our <Link href="/privacy">Privacy Policy</Link>.</p>

      <h2>How to connect</h2>
      <ol className="mb-4 list-decimal pl-6">
        <li className="mb-1.5">Sign in to your client portal and open <b>Your setup</b>.</li>
        <li className="mb-1.5">Under Booking calendar, press <b>Connect Google Calendar</b>.</li>
        <li className="mb-1.5">Choose your Google account and press <b>Allow</b>.</li>
      </ol>

      <h2>How to disconnect</h2>
      <p>In your portal, open <b>Your setup</b> and press <b>Disconnect calendar</b>. This revokes our access with Google straight away, and new bookings use the built-in calendar. You can also remove access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>

      <h2>Questions</h2>
      <p>Email <a href="mailto:team@headabovedigital.com">team@headabovedigital.com</a>.</p>
    </LegalPage>
  );
}
