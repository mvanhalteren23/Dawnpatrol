import type { Metadata } from "next";
import Link from "next/link";
import { INDUSTRIES, PRICING } from "@/lib/site-content";
import { DemoButton } from "@/components/site/Demo";
import { DispatchSimulator } from "@/components/site/DispatchSimulator";
import { OnboardingBanner, PricingSection } from "@/components/site/Pricing";
import { Eyebrow, liveDemo } from "@/components/site/Sections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Head Above Digital | AI Voice Receptionist for the Trades",
  description: `24/7 AI voice receptionist and lead management for contractors, auto repair shops and local storefronts. Answers every call, books the job and texts you the details. $${PRICING.monthly}/month with ${PRICING.includedMinutes} minutes.`,
  alternates: { canonical: "/" },
};

const TRADE_CARDS = [
  { id: "contractors", title: "Contractors & Field Trades", sub: "Plumbers, electricians, HVAC, roofers & general contractors. Qualifies scope & books site estimates." },
  { id: "mechanics", title: "Auto Repair & Mechanics", sub: "Logs year/make/model, books bay drop-offs, and sends NAPA/Lordco parts calls to the back desk." },
  { id: "retail", title: "Small Business & Storefronts", sub: "Answers hours & directions while booking fittings and routing freight deliveries." },
] as const;

const X = <span className="font-bold text-[#A8401F]" aria-hidden="true">✕</span>;
const CHECK = <span className="font-bold text-[#D8B47A]" aria-hidden="true">✓</span>;

export default async function Home() {
  const demo = await liveDemo();
  return (
    <>
      <section className="border-b-4 border-[#173022] bg-[#1F3B2D] py-14 text-[#EFE6D4] lg:py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="space-y-6 lg:col-span-7">
            <Eyebrow dark>Voice AI for the trades • 24/7 dispatch &amp; booking</Eyebrow>
            <h1 style={{ lineHeight: 0.92 }} className="font-condensed-800 text-5xl text-[#EFE6D4] sm:text-6xl lg:text-[72px]">Every call answered, even when you&apos;re on the tools.</h1>
            <p className="max-w-2xl text-lg font-medium leading-[28px] text-[#EFE6D4] sm:text-[18px]">
              When you are under a sink, under a hood, or ringing up a line of customers, missed calls go straight to the next shop on Google. Head Above Digital answers every call, books the job into your calendar, and texts you the address—while routing parts suppliers straight to your counter.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <DemoButton>Book a demo</DemoButton>
              <a href="#dispatch-simulator" className="inline-flex h-[48px] items-center rounded-[12px] border-2 border-[#EFE6D4] px-6 text-sm font-semibold text-[#EFE6D4] hover:no-underline">Hear a sample call</a>
            </div>
            {demo ? <p className="text-sm text-[#EFE6D4]/85">Or call our own AI receptionist: <a href={`tel:${demo.tel}`} className="font-semibold text-[#D8B47A]">{demo.label}</a></p> : null}
            <div className="grid max-w-xl grid-cols-3 gap-4 border-t border-[#173022] pt-4">
              <div><div className="font-condensed-800 text-2xl text-[#D8B47A]">24/7</div><div className="text-xs text-[#EFE6D4]">Every call picked up, no voicemail</div></div>
              <div><div className="font-condensed-800 text-2xl text-[#D8B47A]">${PRICING.monthly} / MO</div><div className="text-xs text-[#EFE6D4]">{PRICING.includedMinutes} call minutes included</div></div>
              <div><div className="font-condensed-800 text-2xl text-[#D8B47A]">ZERO TECH</div><div className="text-xs text-[#EFE6D4]">We set it up &amp; support by phone</div></div>
            </div>
          </div>

          <div className="space-y-5 rounded-[20px] border-2 border-[#6B5A43] bg-[#173022] p-6 sm:p-8 lg:col-span-5">
            <div style={{ letterSpacing: "0.2em" }} className="font-condensed-700 text-xs uppercase text-[#D8B47A]">Built for your workday</div>
            <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-3xl text-[#EFE6D4] sm:text-4xl">Pick your trade to see how we run your front desk:</h2>
            <div className="space-y-3">
              {TRADE_CARDS.map((t) => (
                <Link key={t.id} href={INDUSTRIES[t.id].path} className="group flex w-full items-start justify-between gap-4 rounded-[12px] border border-[#6B5A43] bg-[#1F3B2D] p-4 text-left transition-colors hover:border-[#D8B47A] hover:no-underline">
                  <div>
                    <div className="font-condensed-700 text-xl text-[#EFE6D4] group-hover:text-[#D8B47A]">{t.title}</div>
                    <p className="mt-1 text-sm text-[#EFE6D4]/80">{t.sub}</p>
                  </div>
                  <span className="font-condensed-700 mt-1 shrink-0 text-lg text-[#D8B47A]" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 max-w-3xl">
          <Eyebrow>The real business problem</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#1F3B2D] sm:text-[48px]">Voicemail doesn&apos;t book jobs. It sends your customer to the next listing.</h2>
          <p className="mt-3 text-[18px] font-medium leading-[28px] text-[#6B5A43]">When a homeowner has a leaking water heater or a driver hears their brakes grinding, they don&apos;t leave a voicemail and wait four hours. They hang up and call the next shop that picks up.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-[20px] border-2 border-[#A8401F] bg-[#EFE6D4] p-6 sm:p-8">
            <div className="inline-flex rounded-[6px] bg-[#A8401F] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#EFE6D4]">Without Head Above Digital</div>
            <h3 className="font-condensed-700 text-[32px] leading-[1.05] text-[#1F3B2D]">The daily job-site chaos</h3>
            <ul className="space-y-3 text-base text-[#1F3B2D]">
              <li className="flex items-start gap-3">{X}<span>Shutting off saws or climbing down ladders just to catch a tire-kicker or spam call.</span></li>
              <li className="flex items-start gap-3">{X}<span>Wiping grease off your hands mid-repair while a customer in the bay waits on you.</span></li>
              <li className="flex items-start gap-3">{X}<span>After-hours and weekend emergencies ringing out to a full voicemail box.</span></li>
              <li className="flex items-start gap-3">{X}<span>Parts suppliers and sub-trades stuck on hold while you answer &ldquo;How late are you open?&rdquo;</span></li>
            </ul>
          </div>
          <div className="space-y-4 rounded-[20px] border-2 border-[#173022] bg-[#1F3B2D] p-6 text-[#EFE6D4] sm:p-8">
            <div className="inline-flex rounded-[6px] bg-[#D8B47A] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#1F3B2D]">With Head Above Digital</div>
            <h3 className="font-condensed-700 text-[32px] leading-[1.05] text-[#EFE6D4]">Like having a veteran dispatcher on the desk</h3>
            <ul className="space-y-3 text-base text-[#EFE6D4]">
              <li className="flex items-start gap-3">{CHECK}<span>Every call answered in plain, helpful language—24 hours a day, 7 days a week.</span></li>
              <li className="flex items-start gap-3">{CHECK}<span>Qualifies the job, grabs the address or vehicle make/model, and books straight into your calendar.</span></li>
              <li className="flex items-start gap-3">{CHECK}<span>Sends the customer an instant confirmation text and texts you the full job summary.</span></li>
              <li className="flex items-start gap-3">{CHECK}<span>Filters out parts drivers and sub-trades and patches them straight through to your cell or parts counter.</span></li>
            </ul>
          </div>
        </div>
      </section>

      <DispatchSimulator />
      <PricingSection tierName="All-Trades Pro Plan" />
      <OnboardingBanner />
    </>
  );
}
