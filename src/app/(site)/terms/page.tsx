import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/LegalPage";
import { PRICES, PRICING } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Terms of Service | Head Above Digital",
  description: "The terms for using Head Above Digital's AI receptionist service, client portal and website.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "November 6, 2026";
const EMAIL = "team@headabovedigital.com";

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updated={UPDATED}
      intro={<p>These terms apply to Head Above Digital&apos;s AI receptionist service, the client portal and our website. By signing up for or using the service, your business agrees to them. If you have a separate signed agreement with us, that agreement takes priority where it differs.</p>}
    >
      <h2>The service</h2>
      <p>We set up and run an AI receptionist for your business. It answers your calls and texts, answers questions from the information you give us, books appointments, takes messages, and sends you and your customers confirmations and summaries. You can see your calls, bookings and settings in your client portal.</p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your portal login private and tell us promptly if you think someone else has used it.</li>
        <li>You are responsible for the information you give us about your business being accurate and up to date. Your receptionist answers from it.</li>
        <li>Anyone who calls or texts from a number you have registered as an owner number can make changes to your receptionist by phone or text, and every change is confirmed to you by text so you can undo it. Keep that list current.</li>
      </ul>

      <h2>Plans, billing and cancellation</h2>
      <ul>
        <li>Plans are billed monthly in advance, in Canadian dollars (or US dollars for US businesses). Prices start at CA${PRICES.CAD.monthly} (US${PRICES.USD.monthly}) a month with {PRICING.includedMinutes} call minutes included, and there is no setup fee.</li>
        <li>Canadian businesses are charged GST or HST as applicable.</li>
        <li>Minutes over your plan are billed in {PRICING.blockMinutes}-minute blocks on your next invoice. We let you know when you reach 75% of your minutes.</li>
        <li>Plans have a {PRICING.minimumMonths}-month minimum term. After that, you can cancel at any time from your portal, effective at the end of your current billing period.</li>
        <li>Add-ons, such as the website follow-up agent, are billed monthly with your plan.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li><b>Laws that apply to your calls and messages.</b> You are responsible for complying with the laws that apply to your business, including any requirement to tell callers that calls are recorded or handled by an AI system, and consent rules for texts and calls to your customers. We give you settings to help, but you decide how they are used.</li>
        <li><b>Acceptable use.</b> Don&apos;t use the service for anything unlawful, deceptive, or harassing; for unsolicited marketing calls or texts; or for emergency services. The receptionist tells callers in danger to call 911 and is not a substitute for emergency services.</li>
        <li>Don&apos;t try to misuse, overload or get around the protections on the service, including the limits on calls and minutes.</li>
      </ul>

      <h2>AI limitations</h2>
      <p>Your receptionist is an AI system. It is designed to answer only from the information you provide and to take a message when it isn&apos;t sure, but it can occasionally misunderstand a caller or make a mistake. Review your call summaries, keep your information current, and let us know about anything that needs fixing. Don&apos;t rely on it for decisions where an error could cause serious harm.</p>

      <h2>Connected accounts</h2>
      <p>If you connect your Google Calendar, we use it only to check when you&apos;re busy and to add, change and remove the appointments your receptionist books. You can disconnect at any time. See our <Link href="/privacy">Privacy Policy</Link> and <Link href="/google-calendar">Google Calendar connection</Link> page.</p>

      <h2>Your information</h2>
      <p>Your business information, call records and bookings belong to you. We use them only to provide and support the service, as described in our <Link href="/privacy">Privacy Policy</Link>. When your account closes, we delete them on request, or after the account closes.</p>

      <h2>Availability and changes</h2>
      <p>We work to keep the service running around the clock but can&apos;t promise it will never be interrupted; phone networks and the providers we rely on can have outages. We may improve or change features over time and will tell you about significant changes. We may update these terms; we&apos;ll post the new version here and tell you about material changes.</p>

      <h2>Liability</h2>
      <p>To the extent the law allows, the service is provided &ldquo;as is&rdquo;. We are not liable for indirect or consequential losses such as lost profits or missed opportunities, and our total liability for any claim is limited to the fees you paid us in the three months before the claim arose.</p>

      <h2>Suspension and ending</h2>
      <p>We may suspend or end the service if fees are unpaid or these terms are seriously breached, after giving notice where reasonable. You can cancel as described above.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of British Columbia and the federal laws of Canada that apply there.</p>

      <h2>Contact</h2>
      <p>Head Above Digital, Squamish, British Columbia, Canada · <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
    </LegalPage>
  );
}
