import type { Metadata } from "next";
import { annualCents } from "@/lib/billing-rules";
import { FOLLOWUP_ADDON_PRICE, PLAN_NAME, PRICES, PRICING } from "@/lib/site-content";
import { BrandLogo } from "@/components/site/BrandLogo";
import { PrintButton } from "./PrintButton";

// A one-page summary of the service to send to prospects: features, benefits, price and add-ons.
// Prices come from site-content, so it always matches the website. Prints (or saves as PDF) on
// one US Letter page. Every claim here matches the website and the product today.

export const metadata: Metadata = {
  title: "Head Above Digital: AI Receptionist one-pager",
  description: "Features, benefits, price and add-ons of the Head Above Digital AI receptionist, on one page.",
  robots: { index: false },
  alternates: { canonical: "/one-pager" },
};

const cad = PRICES.CAD;
const usd = PRICES.USD;
const yearlyCad = (annualCents(cad.monthly * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const yearlyUsd = (annualCents(usd.monthly * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

const FEATURES: [string, string][] = [
  ["Answers every call, 24/7", "In plain, friendly language. No voicemail and no busy signal: it answers calls at the same time."],
  ["Books the job", "Qualifies the call, gets the address or vehicle details, and books into your Google Calendar or your own booking link."],
  ["Texts everyone", "The customer gets a confirmation and reminder; you get the full summary after every call."],
  ["Routes the right calls to you", "Suppliers, parts runs, sub-trades and urgent calls go straight to your cell or counter."],
  ["Knows your business", "Your services, hours, area and policies, set up by us and updated whenever you ask."],
  ["Your dashboard", "Every call's transcript and summary, bookings, messages, and weekly and monthly reports."],
  ["Keeps your number", "Forward from any Canadian or US carrier, or move your number to us."],
  ["Google reviews", "After a booked appointment, customers can get a short text asking for a review."],
];

const BENEFITS: [string, string][] = [
  ["Stop losing jobs to voicemail", "Callers who get voicemail often just call the next listing."],
  ["Stay on the tools", "No more stopping work, or calling people back at night."],
  ["Sound like a bigger shop", "Every caller gets a quick, professional answer, even after hours."],
  ["Zero tech for you", "We build it, test it and make changes for you by phone."],
];

export default function OnePager() {
  return (
    <div className="font-barlow min-h-screen bg-[#d9cfbb] py-6 text-[#1F3B2D] print:bg-white print:py-0">
      <style>{`@page { size: letter; margin: 0; } @media print { html, body { background: #fff; } .sheet { box-shadow: none !important; margin: 0 !important; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-[8.5in] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <span className="text-sm text-[#6B5A43]">One-page summary for prospects. Share this link, or save it as a PDF.</span>
        <PrintButton />
      </div>
      <article className="sheet mx-auto flex h-[11in] w-[8.5in] max-w-full flex-col overflow-hidden bg-[#EFE6D4] shadow-2xl print:max-w-none">
        <header className="bg-[#1F3B2D] px-10 pb-6 pt-7 text-[#EFE6D4]">
          <div className="flex items-start justify-between gap-6">
            <BrandLogo />
            <div className="text-right text-[11px] leading-4 text-[#EFE6D4]/80">headabovedigital.com<br />team@headabovedigital.com<br />Squamish, BC</div>
          </div>
          <div style={{ letterSpacing: "0.2em" }} className="font-condensed-700 mt-5 text-[11px] uppercase text-[#D8B47A]">24/7 AI receptionist for trades, shops, storefronts &amp; brokers</div>
          <h1 style={{ lineHeight: 0.95 }} className="font-condensed-800 mt-1 text-[40px] text-[#EFE6D4]">Every call answered, even when you&apos;re on the tools.</h1>
          <p className="mt-2 max-w-[6.2in] text-[13px] leading-5 text-[#EFE6D4]/90">
            Head Above Digital answers every call to your business, books the job into your calendar and texts you the details, while sending suppliers straight to you. Your customers keep calling the number they already have.
          </p>
        </header>

        <div className="grid flex-1 grid-cols-12 gap-6 px-10 pt-6">
          <section className="col-span-7">
            <h2 style={{ letterSpacing: "0.16em" }} className="font-condensed-700 mb-2 text-[12px] uppercase text-[#A87A33]">What it does</h2>
            <ul className="space-y-2">
              {FEATURES.map(([t, d]) => (
                <li key={t} className="flex gap-2 text-[11.5px] leading-[15px]">
                  <span className="mt-[1px] font-bold text-[#A87A33]" aria-hidden="true">✓</span>
                  <span><b className="text-[#1F3B2D]">{t}.</b> <span className="text-[#4d4131]">{d}</span></span>
                </li>
              ))}
            </ul>

            <h2 style={{ letterSpacing: "0.16em" }} className="font-condensed-700 mb-2 mt-5 text-[12px] uppercase text-[#A87A33]">Why owners use it</h2>
            <div className="grid grid-cols-2 gap-2">
              {BENEFITS.map(([t, d]) => (
                <div key={t} className="rounded-[10px] border border-[#1F3B2D]/25 bg-[#F7F2E8] p-2.5">
                  <div className="font-condensed-700 text-[15px] leading-4 text-[#1F3B2D]">{t}</div>
                  <p className="mt-1 text-[10.5px] leading-[14px] text-[#4d4131]">{d}</p>
                </div>
              ))}
            </div>
          </section>

          <aside className="col-span-5 space-y-3">
            <div className="rounded-[14px] bg-[#1F3B2D] p-4 text-[#EFE6D4]">
              <span className="rounded-[5px] bg-[#D8B47A] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#1F3B2D]">{PLAN_NAME}</span>
              <div className="mt-2 flex items-end gap-1.5">
                <span className="font-condensed-800 text-[44px] leading-none text-[#D8B47A]">{cad.symbol}{cad.monthly}</span>
                <span className="pb-1 text-[11px] text-[#EFE6D4]/85">/ month</span>
              </div>
              <div className="text-[10.5px] text-[#EFE6D4]/80">{usd.symbol}{usd.monthly}/month for US businesses</div>
              <ul className="mt-3 space-y-1.5 text-[11px] leading-[14px]">
                <li><b className="text-[#D8B47A]">{PRICING.includedMinutes} call minutes</b> included every month</li>
                <li><b className="text-[#D8B47A]">Yearly:</b> {cad.symbol}{yearlyCad} upfront ({usd.symbol}{yearlyUsd}), save 20%</li>
                <li><b className="text-[#D8B47A]">No setup fee, no contract:</b> cancel any time</li>
                <li><b className="text-[#D8B47A]">Setup and phone support</b> included</li>
              </ul>
              <div className="mt-2 text-[9.5px] text-[#EFE6D4]/70">Plus GST/HST for Canadian businesses.</div>
            </div>

            <div className="rounded-[14px] border-2 border-[#1F3B2D] bg-[#F7F2E8] p-4">
              <h2 style={{ letterSpacing: "0.16em" }} className="font-condensed-700 text-[12px] uppercase text-[#A87A33]">Add-ons</h2>
              <div className="mt-2 border-b border-[#1F3B2D]/15 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="font-condensed-700 text-[16px]">Follow-Up Agent</b>
                  <span className="font-condensed-800 whitespace-nowrap text-[16px] text-[#A87A33]">{FOLLOWUP_ADDON_PRICE ? `+${cad.symbol}${FOLLOWUP_ADDON_PRICE.CAD}/mo` : "Ask us"}</span>
                </div>
                <p className="text-[10.5px] leading-[14px] text-[#4d4131]">Calls every website enquiry back within minutes, asks your questions and books the next step. Works with Wix, WordPress, Squarespace, Zapier or Make.{FOLLOWUP_ADDON_PRICE ? ` (${usd.symbol}${FOLLOWUP_ADDON_PRICE.USD}/mo in the US.)` : ""}</p>
              </div>
              <div className="mt-2">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="font-condensed-700 text-[16px]">Extra minutes</b>
                  <span className="font-condensed-800 whitespace-nowrap text-[16px] text-[#A87A33]">{cad.symbol}{cad.blockPrice} / {PRICING.blockMinutes} min</span>
                </div>
                <p className="text-[10.5px] leading-[14px] text-[#4d4131]">Only if a busy month goes past {PRICING.includedMinutes} minutes, in {PRICING.blockMinutes}-minute blocks ({usd.symbol}{usd.blockPrice} in the US). {PRICING.includedMinutes} minutes is about 100 to 130 typical calls.</p>
              </div>
            </div>

            <div className="rounded-[14px] border border-[#1F3B2D]/25 p-3 text-[10.5px] leading-[14px] text-[#4d4131]">
              <b className="text-[#1F3B2D]">The math:</b> if it saves just two missed jobs a week at {cad.symbol}450 each, that&apos;s about {cad.symbol}3,600 a month of work, from a {cad.symbol}{cad.monthly} plan. <span className="italic">An example, not a guarantee.</span>
            </div>
          </aside>
        </div>

        <section className="mx-10 mt-auto rounded-[12px] bg-[#F7F2E8] px-4 py-3 text-[11px] leading-[15px] text-[#4d4131]">
          <b style={{ letterSpacing: "0.16em" }} className="font-condensed-700 mr-2 text-[12px] uppercase text-[#A87A33]">Works with</b>
          Your current number (Telus, Rogers, Bell, Shaw, Freedom and the rest) · Google Calendar, or your own Head Above booking link · text messages, including photos from customers · email reports · Wix, WordPress, Squarespace, Zapier and Make forms.
        </section>

        <section className="mx-10 mb-3 mt-4 grid grid-cols-4 gap-3 border-t-2 border-[#1F3B2D] pt-3">
          {[
            ["1", "Demo", "Hear it answer as your business."],
            ["2", "Setup call", "We learn your services, hours and rules."],
            ["3", "We build it", "Call flow, calendar and texts, tested."],
            ["4", "Go live", "Forward your number. Done."],
          ].map(([n, t, d]) => (
            <div key={n} className="flex gap-2">
              <span className="font-condensed-800 text-[22px] leading-none text-[#A87A33]">{n}</span>
              <span className="text-[10.5px] leading-[13px]"><b className="block text-[#1F3B2D]">{t}</b><span className="text-[#4d4131]">{d}</span></span>
            </div>
          ))}
        </section>

        <footer className="flex items-center justify-between gap-4 bg-[#173022] px-10 py-3 text-[11px] text-[#EFE6D4]">
          <span><b className="text-[#D8B47A]">Book a demo:</b> headabovedigital.com/book · team@headabovedigital.com</span>
          <span className="text-[9.5px] text-[#EFE6D4]/70">Calls aren&apos;t recorded: we keep a transcript and summary. PIPEDA &amp; BC PIPA.</span>
        </footer>
      </article>
    </div>
  );
}
