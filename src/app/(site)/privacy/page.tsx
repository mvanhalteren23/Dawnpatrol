import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | Head Above Digital",
  description: "How Head Above Digital collects, uses and protects information, including Google user data from connected Google Calendars.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "November 6, 2026";
const EMAIL = "team@headabovedigital.com";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={UPDATED}
      intro={<p>Head Above Digital (&ldquo;we&rdquo;, &ldquo;us&rdquo;) builds and runs AI receptionists for small businesses in Canada and the United States. This policy explains what information we handle, why, who we share it with, and the choices you have. It covers our website, our client portal and CRM, and the AI receptionists we operate for our clients.</p>}
    >
      <h2>Who we are</h2>
      <p>Head Above Digital is a business name of Luna VR Inc., based in Squamish, British Columbia, Canada. For any privacy question or request, email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

      <h2>Information we handle</h2>
      <h3>Visitors to our website</h3>
      <ul>
        <li>What you send us through a form, such as a demo request: your name, business, phone number, email and message.</li>
        <li>Basic technical information our hosting provider records, such as your IP address, browser and the pages you visit, used to run and secure the site.</li>
      </ul>
      <h3>Our clients (businesses that use our service)</h3>
      <ul>
        <li>Account details: business name, contact names, email addresses, phone numbers and billing details. Card payments are handled by Stripe; we never see or store full card numbers.</li>
        <li>What you tell us about your business so your receptionist can answer callers: services, hours, prices, policies and similar information.</li>
        <li>Settings you choose, such as your business hours, booking rules, branding and notification preferences.</li>
      </ul>
      <h3>People who call or text our clients&apos; businesses</h3>
      <p>When someone calls or texts a business that uses our service, we process the call or message <b>on that business&apos;s behalf</b>. Calls are not recorded: we keep a written transcript and summary, not the audio, and if a caller leaves a voicemail its audio is deleted once it has been transcribed. This can include the caller&apos;s phone number, what they say (a transcript and a summary of the call), the details they give (such as name, email and the reason for calling), any appointment they book, and text messages they send. If a customer texts photos to the business, we keep the photos for 60 days (then delete them) so the business can see them, and a caller who has called or booked before may be recognised by phone number so the receptionist can greet them or ask about their appointment. The business decides how this information is used. Callers with questions about their information should contact the business they called; we will help that business respond.</p>

      <h2>How we use information</h2>
      <ul>
        <li>To answer calls and texts, book appointments, take messages and send confirmations and reminders for our clients.</li>
        <li>To show our clients their calls, bookings and reports in their portal, and to alert them to new leads.</li>
        <li>To set up, support, bill for and improve our service, and to keep it secure, including preventing abuse of phone lines.</li>
        <li>To respond to demo requests and enquiries.</li>
      </ul>
      <p>We do not sell personal information, and we do not use our clients&apos; or callers&apos; information for advertising.</p>

      <h2>Google user data (Google Calendar)</h2>
      <p>Clients can choose to connect their Google Calendar so their AI receptionist can book appointments into it. If you connect your Google account, here is exactly what happens:</p>
      <ul>
        <li><b>What we access:</b> your calendar&apos;s free/busy information (when you are busy, without event details), and permission to create, update and delete the events our receptionist books for you. We also receive your Google account&apos;s email address, to show which calendar is connected.</li>
        <li><b>How we use it:</b> only to find times you are available, to put appointments your receptionist books into your calendar (which sends the invitation to your customer from your calendar), and to update or remove those appointments when they are rescheduled or cancelled.</li>
        <li><b>What we don&apos;t do:</b> we do not read the details of your other calendar events, we do not use your Google data for advertising, we do not sell it, and we do not use it to train AI models. People at Head Above Digital do not read your Google data except with your permission to help with a support request, where needed for security, or where required by law.</li>
        <li><b>Storage and protection:</b> the access token Google gives us is stored encrypted. Busy/free times are used at the moment of booking and not stored. The bookings we create are kept in your account so you can see them in your portal.</li>
        <li><b>Disconnecting:</b> you can disconnect at any time in your portal (Your setup → Disconnect calendar), which revokes our access with Google immediately. You can also remove access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</li>
      </ul>
      <p><b>Head Above Digital&apos;s use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</b></p>
      <p>More about the connection: <Link href="/google-calendar">Google Calendar connection</Link>.</p>

      <h2>Who we share information with</h2>
      <p>We use trusted service providers to run our service. They process information only to provide their service to us:</p>
      <ul>
        <li>ElevenLabs (the AI voice that answers calls) and Twilio (phone calls and text messages).</li>
        <li>AI providers (Anthropic and Google) to understand requests, summarize calls and draft content. Google Calendar data is never sent to them.</li>
        <li>Google (Google Workspace and, if you connect it, Google Calendar), Vercel (hosting), Neon (database), Stripe (payments).</li>
      </ul>
      <p>Some of these providers store or process information in the United States. We may also disclose information if required by law or to protect the rights, safety and security of our clients, callers or our service.</p>

      <h2>How long we keep information</h2>
      <ul>
        <li>Call transcripts held by our voice provider are deleted after 90 days.</li>
        <li>Photos customers text to a business are deleted after 60 days.</li>
        <li>Call logs, bookings, messages and knowledge in a client&apos;s account are kept while the account is active, so the client can see their history, and deleted when the client asks or after the account closes.</li>
        <li>Encrypted database backups are kept for 30 days.</li>
      </ul>

      <h2>Security</h2>
      <p>We protect information with encryption in transit, encrypted storage of sensitive credentials, access limited to the people who need it, two-step sign-in for our team's accounts, and monitoring for abuse. No system is perfectly secure; if a breach affects your information, we will notify you and the authorities as the law requires.</p>

      <h2>Your choices and rights</h2>
      <p>You can ask to see, correct or delete personal information we hold about you, or withdraw consent, by emailing <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. Callers can reply STOP to any text to stop receiving texts from that business. We handle requests under Canada&apos;s PIPEDA and British Columbia&apos;s Personal Information Protection Act, and other privacy laws that apply.</p>

      <h2>Children</h2>
      <p>Our service is for businesses and is not directed to children.</p>

      <h2>Changes</h2>
      <p>We may update this policy. We will post the new version here with a new date, and tell clients about significant changes.</p>

      <h2>Contact</h2>
      <p>Luna VR Inc., doing business as Head Above Digital, Squamish, British Columbia, Canada · <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
    </LegalPage>
  );
}
