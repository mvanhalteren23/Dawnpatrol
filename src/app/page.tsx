import Link from "next/link";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { companyName } from "@/lib/brand";
import { db } from "@/lib/db";
import { demoLineConfig, formatPhone } from "@/lib/demo-line";
import { InquiryForm } from "@/components/site/InquiryForm";

// The public website. AI voice agents are the main service; AI consulting & business tooling and
// custom work come second. Clients sign in here to their portal (calls, reports, settings).

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const company = await companyName();
  return {
    title: `${company} | AI voice agents that answer every call`,
    description: "AI receptionists for BC service businesses: answers 24/7, books into your calendar, transfers urgent calls, and keeps your existing number. $135/month, 200 minutes, no setup fee.",
  };
}

const PRICE = { monthly: 135, minutes: 200, minimumMonths: 3 };

const FEATURES = [
  { title: "Answers every call, 24/7", body: "Nights, weekends, lunch breaks and while you're on a job. No voicemail, no hold music." },
  { title: "Knows your business", body: "Answers from your own services, prices, service area and policies. If it doesn't know, it takes a message rather than guessing." },
  { title: "Books into your calendar", body: "Offers real open times from your Google Calendar, by phone or Google Meet, with your hours, notice period and holidays respected." },
  { title: "Sends urgent calls to you", body: "Emergencies are transferred to your cell straight away. You decide what counts as urgent." },
  { title: "Rings you first, if you like", body: "Your cell rings first; if you can't pick up, the receptionist answers. Or have it answer everything." },
  { title: "Keeps your existing number", body: "Forward missed calls from the number on your truck and website, or move the number over entirely." },
  { title: "Screens spam and sales calls", body: "Robocalls are filtered out and vendors get a message taken, so your phone only rings for customers." },
  { title: "Follows up for you", body: "Callers get a text or email summary of what was agreed, and you get every call's summary and recording." },
];

const STEPS = [
  { n: "1", title: "A 30-minute intake call", body: "We learn your services, hours, service area and how you want urgent calls handled. We build the knowledge base from your website and your answers." },
  { n: "2", title: "Test it together", body: "You call it, try to trip it up, and we tune it until it sounds like your front desk. Most businesses are live within a week." },
  { n: "3", title: "Switch your calls over", body: "Forward missed calls from your current number, or use a new local number. Nothing changes for your customers except that someone always answers." },
];

const INCLUDED = [
  "24/7 call answering",
  `${PRICE.minutes} minutes of calls a month`,
  "Appointment booking into Google Calendar",
  "Urgent call transfer to your cell",
  "Text or email summaries to callers",
  "Keep your existing number",
  "Client dashboard: calls, recordings and transcripts",
  "Weekly and monthly reports, sent where you choose",
  "Knowledge base you can update any time",
];

const CONSULTING = [
  { title: "Workflow automation", body: "Calls, forms and emails flowing into the tools you already use, such as Jobber, Housecall Pro, QuickBooks or a spreadsheet, without retyping." },
  { title: "AI assistants for the office", body: "Drafting quotes, follow-up emails and job summaries in your voice, with a person approving before anything goes out." },
  { title: "Lead tracking and dashboards", body: "One place to see enquiries, follow-ups and booked jobs, so nothing slips between the phone, the inbox and the truck." },
  { title: "AI readiness review", body: "A practical look at where AI would save you time, what it would cost, and what to leave alone." },
];

const FAQ = [
  { q: "Will callers know it's an AI?", a: "It answers with your business name and a natural voice. If a caller asks, it tells them it's an AI assistant. We never set it up to claim to be a person." },
  { q: "What happens if it can't answer a question?", a: "It takes a message with the caller's details and what they need, sends you the summary straight away, and tells the caller when to expect a call back. Urgent calls are transferred to you." },
  { q: "Can I keep my current phone number?", a: "Yes. Most clients forward missed calls from their existing number, so their phone rings as it does today and the receptionist picks up whatever they miss. You can also move the number to us completely." },
  { q: `What if I use more than ${PRICE.minutes} minutes?`, a: "Tell us if you expect a busier month and we'll set you up with the minutes you need. You can see your talk time any time in your dashboard reports." },
  { q: "Is there a contract?", a: `There's a ${PRICE.minimumMonths}-month minimum term, so there's time to tune the receptionist to your business. There's no setup fee.` },
  { q: "Are calls recorded? Who can see them?", a: "Calls are recorded and transcribed so you can review them in your dashboard, and your greeting lets callers know. Only you and our setup team can open them. Your emailed reports contain totals only, never callers' names or conversations." },
  { q: "How long does setup take?", a: "Usually less than a week from the intake call to going live, depending on how quickly we can test it together." },
];

function Logo({ company }: { company: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0b1530" />
        <path d="M6 21h20" stroke="#f97316" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M10 21a6 6 0 0 1 12 0" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-[#0b1530]">{company}</span>
    </span>
  );
}

export default async function Home() {
  const [company, session, demo, ownLine] = await Promise.all([
    companyName(),
    getSession(),
    demoLineConfig(),
    // The agency's own receptionist (it books our audit calls and adds them to the CRM).
    db.receptionist.findFirst({ where: { bookingAddsToCrm: true, demoExtension: { not: null } }, select: { name: true, demoExtension: true, businessNumber: true } }),
  ]);
  const callNumber = ownLine?.businessNumber ?? demo.number;
  const extension = ownLine?.businessNumber ? null : ownLine?.demoExtension ?? null;
  const agent = ownLine?.name ?? "our receptionist";
  const dashboard = session ? (session.role === "CLIENT" ? "/portal" : "/crm") : null;
  const year = new Date().getFullYear();

  return (
    <div className="bg-white text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="hover:no-underline"><Logo company={company} /></Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex" aria-label="Main">
            <a href="#voice-agents" className="text-slate-600 hover:text-[#0b1530] hover:no-underline">Voice agents</a>
            <a href="#how-it-works" className="text-slate-600 hover:text-[#0b1530] hover:no-underline">How it works</a>
            <a href="#pricing" className="text-slate-600 hover:text-[#0b1530] hover:no-underline">Pricing</a>
            <a href="#consulting" className="text-slate-600 hover:text-[#0b1530] hover:no-underline">Consulting</a>
            <a href="#faq" className="text-slate-600 hover:text-[#0b1530] hover:no-underline">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href={dashboard ?? "/login?next=/portal"} className="rounded-lg px-3 py-2 text-sm font-medium text-[#0b1530] hover:bg-slate-100 hover:no-underline">{dashboard ? "Open dashboard" : "Client login"}</Link>
            <a href="#contact" className="hidden rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 hover:no-underline sm:inline-block">Book a call</a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-[#0b1530] text-white">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-orange-500/60 to-transparent" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-24">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-400">AI voice agents for BC service businesses</p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight text-white [text-wrap:balance] sm:text-5xl">Every call answered. Every job booked.</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
                Your AI receptionist picks up around the clock, answers from your own information, books into your calendar and sends urgent calls straight to you. The call you miss on a ladder stops turning into a job for someone else.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#contact" className="rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 hover:no-underline">Book a 20-minute call</a>
                {callNumber ? (
                  <a href={`tel:${callNumber}`} className="rounded-lg border border-white/25 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 hover:no-underline">
                    Hear it live: {formatPhone(callNumber)}{extension ? `, ext. ${extension}` : ""}
                  </a>
                ) : null}
              </div>
              <p className="mt-6 text-sm text-slate-400">${PRICE.monthly}/month · {PRICE.minutes} minutes included · no setup fee</p>
            </div>

            {/* Example of what lands in the owner's inbox after a call */}
            <figure className="rounded-2xl border border-white/10 bg-white p-5 text-slate-800 shadow-2xl shadow-black/30">
              <figcaption className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium uppercase tracking-wide">Example call summary</span>
                <span>Sat 7:42 pm · 2 min 18 s</span>
              </figcaption>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Booked</span>
                <span className="text-sm font-semibold">Furnace not starting</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Caller in Burnaby, gas furnace not igniting since this afternoon, no smell of gas. Booked a service visit Monday 9:00 am. Confirmed address and best number. Sent the caller a text confirmation.
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
                <div><dt className="text-[11px] uppercase tracking-wide text-slate-500">Answered</dt><dd className="text-sm font-semibold">After hours</dd></div>
                <div><dt className="text-[11px] uppercase tracking-wide text-slate-500">Outcome</dt><dd className="text-sm font-semibold">Appointment</dd></div>
                <div><dt className="text-[11px] uppercase tracking-wide text-slate-500">Follow-up</dt><dd className="text-sm font-semibold">Text sent</dd></div>
              </dl>
            </figure>
          </div>
        </section>

        {/* Features */}
        <section id="voice-agents" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-orange-600">AI voice agents</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#0b1530] [text-wrap:balance]">A front desk that never takes a day off</h2>
              <p className="mt-4 text-lg text-slate-600">Built for trades, home services, auto shops and other businesses where the person who answers the phone is usually busy doing the work.</p>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="bg-white p-6">
                  <h3 className="font-semibold text-[#0b1530]">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-[#0b1530]">Live in about a week</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="relative">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0b1530] text-sm font-semibold text-white">{s.n}</span>
                  <h3 className="mt-4 font-semibold text-[#0b1530]">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Dashboard & reports */}
        <section className="py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-orange-600">Your dashboard</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#0b1530] [text-wrap:balance]">See exactly what your receptionist did</h2>
              <ul className="mt-6 space-y-3 text-slate-600">
                <li className="flex gap-3"><Check />Every call with its summary, recording and transcript</li>
                <li className="flex gap-3"><Check />Weekly and monthly reports: calls answered, after-hours calls, bookings and what they&apos;re worth</li>
                <li className="flex gap-3"><Check />Choose how often reports are emailed, and to whom</li>
                <li className="flex gap-3"><Check />Update your services, prices, hours and holidays yourself</li>
                <li className="flex gap-3"><Check />Callers waiting on a call back, flagged so none slip through</li>
              </ul>
              <Link href="/login?next=/portal" className="mt-8 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-[#0b1530] hover:bg-slate-50 hover:no-underline">Client login →</Link>
            </div>
            <figure className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60">
              <figcaption className="flex items-baseline justify-between">
                <span className="font-semibold text-[#0b1530]">Weekly report</span>
                <span className="text-xs text-slate-500">Example</span>
              </figcaption>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["Calls answered", "38", "+6 vs last week"],
                  ["After hours", "15", "would have gone to voicemail"],
                  ["Booked", "9", "+2 vs last week"],
                  ["Est. value", "$4,050", "9 × $450 average job"],
                ].map(([l, v, s]) => (
                  <div key={l} className="rounded-lg bg-slate-50 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{l}</div>
                    <div className="text-xl font-semibold tabular-nums text-[#0b1530]">{v}</div>
                    <div className="text-xs text-slate-500">{s}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex h-20 items-end gap-1.5" aria-hidden="true">
                {[5, 7, 4, 8, 6, 3, 5].map((h, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t bg-[#0b1530]" style={{ height: `${h * 9}px` }} />
                    <span className="text-[10px] text-slate-400">{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
                  </div>
                ))}
              </div>
            </figure>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 bg-[#0b1530] py-20 text-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white">Simple pricing</h2>
              <p className="mt-3 text-slate-300">One plan with everything included. Prices in Canadian dollars.</p>
            </div>
            <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div className="rounded-2xl bg-white p-8 text-slate-800">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold text-[#0b1530]">AI Voice Agent</h3>
                  <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">No setup fee</span>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-5xl font-semibold tracking-tight text-[#0b1530]">${PRICE.monthly}</span>
                  <span className="text-slate-500">/ month</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{PRICE.minutes} minutes of calls included · {PRICE.minimumMonths}-month minimum term</p>
                <ul className="mt-6 grid gap-2.5 text-sm sm:grid-cols-2">
                  {INCLUDED.map((i) => <li key={i} className="flex gap-2.5"><Check />{i}</li>)}
                </ul>
                <a href="#contact" className="mt-8 inline-block rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700 hover:no-underline">Get started</a>
              </div>
              <div className="flex flex-col justify-between rounded-2xl border border-white/15 p-8">
                <div>
                  <h3 className="text-lg font-semibold text-white">Custom</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">For higher call volumes, several locations or numbers, other languages, outbound calling, or connecting the receptionist to your own systems.</p>
                  <p className="mt-4 text-2xl font-semibold text-white">Quoted for you</p>
                </div>
                <a href="#contact" className="mt-8 inline-block w-fit rounded-lg border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 hover:no-underline">Talk to us</a>
              </div>
            </div>
          </div>
        </section>

        {/* Secondary services */}
        <section id="consulting" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-orange-600">Also available</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#0b1530] [text-wrap:balance]">AI consulting &amp; business tooling</h2>
                <p className="mt-4 text-slate-600">Once the phones are handled, we can help with the rest of the admin. Every project is scoped and quoted up front.</p>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {CONSULTING.map((c) => (
                  <div key={c.title} className="rounded-xl border border-slate-200 p-6">
                    <h3 className="font-semibold text-[#0b1530]">{c.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.body}</p>
                  </div>
                ))}
                <div className="rounded-xl bg-slate-50 p-6 sm:col-span-2">
                  <h3 className="font-semibold text-[#0b1530]">Custom services</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">Something specific in mind, like an outbound reminder caller, an agent for a second location, or a tool built around how your team works? Tell us what you need and we&apos;ll quote it.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-slate-200 bg-slate-50 py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-[#0b1530]">Questions</h2>
            <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {FAQ.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-[#0b1530]">
                    {f.q}
                    <span className="text-slate-400 transition group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="scroll-mt-20 py-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[#0b1530] [text-wrap:balance]">Book a 20-minute call</h2>
              <p className="mt-4 text-slate-600">Tell us about your business and we&apos;ll set up a short call to look at how many calls you&apos;re missing and what an AI receptionist would handle. No obligation.</p>
              {callNumber ? (
                <div className="mt-8 rounded-xl border border-slate-200 p-5">
                  <div className="text-sm font-semibold text-[#0b1530]">Prefer to call?</div>
                  <p className="mt-1 text-sm text-slate-600">
                    Call <span className="select-all font-semibold text-[#0b1530]">{formatPhone(callNumber)}</span>{extension ? <> and enter extension <b>{extension}</b></> : null}. {agent === "our receptionist" ? "Our receptionist" : agent}, our own AI receptionist, will answer and can book the call with you.
                  </p>
                </div>
              ) : null}
            </div>
            <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <InquiryForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:px-6">
          <Logo company={company} />
          <span>AI voice agents and business tooling · British Columbia, Canada</span>
          <span className="flex gap-4">
            <Link href="/login?next=/portal" className="text-slate-500">Client login</Link>
            <span>© {year} {company}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Check() {
  return (
    <svg className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}
