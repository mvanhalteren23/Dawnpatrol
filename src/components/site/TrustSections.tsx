import Image from "next/image";
import Link from "next/link";
import { FAQ } from "@/lib/site-faq";
import { faqJsonLd, jsonLdScript } from "@/lib/seo";
import { Eyebrow } from "./Eyebrow";
import { Reveal } from "./Reveal";

// The trust sections shared by the home page and the industry pages: what it connects to, how
// call data is handled, the FAQ and a look at the client dashboard. Every
// statement here matches the product and the privacy policy; keep them in step.


/** `local`: a town page's own questions (shown in its local section), so the page has one FAQ block for search. */
export function FaqSection({ local = [] }: { local?: { q: string; a: string }[] }) {
  return (
    <section id="faq" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd([...local, ...FAQ])) }} />
      <div className="mb-8 max-w-3xl">
        <Eyebrow>Questions owners ask</Eyebrow>
        <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#1F3B2D] sm:text-[48px]">Straight answers.</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-[12px] border-2 border-[#1F3B2D] bg-[#F7F2E8] p-5 open:bg-[#EFE6D4]">
            <summary className="font-condensed-700 flex cursor-pointer list-none items-center justify-between gap-4 text-xl text-[#1F3B2D]">
              {f.q}
              <span aria-hidden="true" className="text-[#A87A33] transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-base leading-7 text-[#6B5A43]">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const CONNECTS: { title: string; desc: string }[] = [
  { title: "Your current phone number", desc: "Forward from any Canadian or US carrier (Telus, Rogers, Bell, Shaw, Freedom and the rest), or move the number to us." },
  { title: "Google Calendar", desc: "Checks when you're busy before it books, and puts each booking in your calendar with the customer invited." },
  { title: "Online booking link", desc: "No calendar? Bookings go into your own Head Above calendar, and customers get a link to book or move a time." },
  { title: "Text messages", desc: "Confirmations, reminders and a summary to you after every call. Customers can text your number too, including photos." },
  { title: "Email", desc: "Lead alerts, and weekly and monthly reports of calls, bookings and after-hours calls." },
  { title: "Your website's forms", desc: "Wix, WordPress, Squarespace, or anything that works with Zapier or Make: new enquiries are called back within minutes (Follow-Up Agent)." },
  { title: "Google reviews", desc: "After a booked appointment, customers can get a short text asking for a Google review." },
  { title: "Your dashboard", desc: "Every call's transcript and summary, bookings, messages and reports, in one place." },
];

export function ConnectsAndData() {
  return (
    <section className="border-y-2 border-[#1F3B2D] bg-[#173022] py-16 text-[#EFE6D4]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-7">
          <Eyebrow dark>Works with what you already use</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 mb-6 text-4xl text-[#EFE6D4] sm:text-[44px]">What it connects to.</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CONNECTS.map((c) => (
              <li key={c.title} className="rounded-[12px] border border-[#6B5A43] bg-[#1F3B2D] p-4">
                <div className="font-condensed-700 text-xl text-[#D8B47A]">{c.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-[#EFE6D4]/90">{c.desc}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[#EFE6D4]/80">Using Jobber, Housecall Pro, Tekmetric or another system? Ask us: we&apos;ll tell you honestly what works today.</p>
        </div>
        <div id="your-data" className="scroll-mt-24 space-y-4 rounded-[20px] border-2 border-[#6B5A43] bg-[#1F3B2D] p-6 sm:p-8 lg:col-span-5">
          <Eyebrow dark>Your callers&apos; information</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-3xl text-[#EFE6D4] sm:text-[36px]">How call data is handled.</h2>
          <ul className="space-y-3 text-sm leading-relaxed text-[#EFE6D4]">
            <li><strong className="text-[#D8B47A]">Calls aren&apos;t recorded.</strong> We keep a written transcript and summary, not the audio. Voicemail audio is deleted once it&apos;s been transcribed.</li>
            <li><strong className="text-[#D8B47A]">How long:</strong> transcripts held by our voice provider are deleted after 90 days. Photos customers text you are deleted after 60 days. Your call history stays in your account while you&apos;re a client and is deleted when you ask or after you leave. Encrypted backups are kept for 30 days.</li>
            <li><strong className="text-[#D8B47A]">Where:</strong> with the providers that run the service (ElevenLabs for the voice, Twilio for calls and texts, Anthropic and Google AI for call summaries, and our database and hosting). Some of them store or process data in the United States.</li>
            <li><strong className="text-[#D8B47A]">The law:</strong> we handle personal information under Canada&apos;s PIPEDA and BC&apos;s Personal Information Protection Act. We never sell it or use it for advertising, and your calendar data is never used to train AI.</li>
            <li><strong className="text-[#D8B47A]">Security:</strong> encryption in transit, encrypted credentials, two-step sign-in for our team, and access only for the people who need it.</li>
          </ul>
          <Link href="/privacy" className="inline-block text-sm font-semibold text-[#D8B47A]">Read the full privacy policy →</Link>
        </div>
      </div>
    </section>
  );
}

/** The client dashboard, as a real screenshot (sample business, invented calls). */
export function ResultsPreview() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid items-center gap-10 lg:grid-cols-12">
        <Reveal className="space-y-4 lg:col-span-5">
          <Eyebrow>Your results dashboard</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#1F3B2D] sm:text-[48px]">See what it caught for you.</h2>
          <p className="text-[18px] font-medium leading-[28px] text-[#6B5A43]">Sign in any time to see the calls it answered, the appointments it booked, an estimate of the revenue from those bookings, and the callers waiting on you. A report lands in your inbox every week or month.</p>
          <ul className="space-y-2 text-base text-[#1F3B2D]">
            <li>✓ Calls answered, and after-hours calls in your reports</li>
            <li>✓ Appointments booked and leads captured</li>
            <li>✓ Estimated revenue from bookings, from your average job value</li>
            <li>✓ Every call&apos;s transcript and summary</li>
          </ul>
        </Reveal>
        <div className="lg:col-span-7">
          <figure className="overflow-hidden rounded-[20px] border-2 border-[#1F3B2D] bg-white shadow-xl">
            <Image src="/images/portal-preview.webp" alt="The client dashboard: calls answered, appointments booked, leads captured, estimated revenue from bookings, and callers waiting for a call back" width={2560} height={1600} className="h-auto w-full" />
          </figure>
          <figcaption className="mt-2 text-xs text-[#6B5A43]">A sample business with invented calls. Your own numbers appear once your line is live.</figcaption>
        </div>
      </div>
    </section>
  );
}
