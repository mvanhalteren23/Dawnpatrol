"use client";
import { useState } from "react";
import { PRICING, type TradeKey } from "@/lib/site-content";
import { DemoButton } from "./Demo";

const CHECK = <span className="font-bold text-[#D8B47A]" aria-hidden="true">✓</span>;

export function PricingSection({ tierName, trade }: { tierName: string; trade?: TradeKey }) {
  const [extraBlocks, setExtraBlocks] = useState(0);
  const [avgJobValue, setAvgJobValue] = useState(450);
  const totalMinutes = PRICING.includedMinutes + extraBlocks * PRICING.blockMinutes;
  const monthly = PRICING.monthly + extraBlocks * PRICING.blockPrice;

  return (
    <section id="pricing" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 max-w-3xl">
        <div style={{ letterSpacing: "0.2em" }} className="font-condensed-700 mb-2 text-sm uppercase text-[#A87A33]">Simple, transparent pricing</div>
        <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#1F3B2D] sm:text-[48px]">One flat plan. Less than the profit on a single missed job.</h2>
        <p className="mt-2 text-[18px] font-medium leading-[28px] text-[#6B5A43]">No per-seat fees and no setup charges. {PRICING.minimumMonths}-month minimum, then month to month. Prices in Canadian dollars.</p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-12">
        <div className="space-y-6 rounded-[20px] border-2 border-[#173022] bg-[#1F3B2D] p-8 text-[#EFE6D4] lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#173022] pb-6">
            <div>
              <span className="rounded-[6px] bg-[#D8B47A] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#1F3B2D]">{tierName}</span>
              <h3 className="font-condensed-800 mt-3 text-3xl text-[#EFE6D4] sm:text-4xl">24/7 AI Receptionist &amp; Lead Dispatch</h3>
            </div>
            <div className="text-left sm:text-right">
              <div className="font-condensed-800 text-5xl text-[#D8B47A]">${PRICING.monthly}</div>
              <div className="text-xs font-medium text-[#EFE6D4]/80">per month • {PRICING.includedMinutes} mins included</div>
            </div>
          </div>
          <ul className="space-y-3 text-base text-[#EFE6D4]">
            <li className="flex items-start gap-3">{CHECK}<span><strong>{PRICING.includedMinutes} call minutes included</strong> every month (~100 to 130 typical trade calls).</span></li>
            <li className="flex items-start gap-3">{CHECK}<span><strong>Predictable {PRICING.blockMinutes}-minute add-on blocks</strong> at ${PRICING.blockPrice} if your busy season spikes.</span></li>
            <li className="flex items-start gap-3">{CHECK}<span><strong>Instant SMS confirmations</strong> to clients and live lead text summaries to you.</span></li>
            <li className="flex items-start gap-3">{CHECK}<span><strong>Smart supplier &amp; sub-trade routing</strong> straight to your parts desk or mobile.</span></li>
            <li className="flex items-start gap-3">{CHECK}<span><strong>White-glove onboarding &amp; direct phone support</strong> whenever you need changes.</span></li>
          </ul>
          <DemoButton trade={trade} className="w-full px-8 sm:w-auto">Start with {tierName}</DemoButton>
        </div>

        <div className="space-y-6 rounded-[20px] border-2 border-[#1F3B2D] bg-[#EFE6D4] p-6 sm:p-8 lg:col-span-5">
          <div>
            <div style={{ letterSpacing: "0.2em" }} className="font-condensed-700 text-xs uppercase text-[#A87A33]">Usage &amp; payback estimator</div>
            <h3 className="font-condensed-700 mt-1 text-2xl text-[#1F3B2D]">Check your monthly call volume:</h3>
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 flex justify-between text-sm font-semibold"><span>Extra {PRICING.blockMinutes}-minute blocks:</span><span>+{extraBlocks * PRICING.blockMinutes} mins ({totalMinutes} total)</span></span>
              <input type="range" min={0} max={5} value={extraBlocks} onChange={(e) => setExtraBlocks(Number(e.target.value))} className="w-full cursor-pointer accent-[#1F3B2D]" />
            </label>
            <label className="block">
              <span className="mb-1 flex justify-between text-sm font-semibold"><span>Your average job / repair value:</span><span>${avgJobValue.toLocaleString()}</span></span>
              <input type="range" min={150} max={2500} step={50} value={avgJobValue} onChange={(e) => setAvgJobValue(Number(e.target.value))} className="w-full cursor-pointer accent-[#1F3B2D]" />
            </label>
          </div>
          <div className="space-y-2 rounded-[12px] bg-[#173022] p-5 text-[#EFE6D4]">
            <div className="flex items-center justify-between text-sm"><span>Estimated monthly plan:</span><span className="font-condensed-800 text-2xl text-[#D8B47A]">${monthly} / mo</span></div>
            <div className="flex items-center justify-between border-t border-[#1F3B2D] pt-2 text-sm"><span>If we save just 2 missed jobs a week:</span><span className="font-condensed-800 text-2xl text-[#EFE6D4]">+${(avgJobValue * 8).toLocaleString()} / mo</span></div>
          </div>
          <p className="text-xs text-[#6B5A43]">An estimate to help you decide, not a guarantee. Your dashboard shows your real minutes every month.</p>
        </div>
      </div>
    </section>
  );
}

export function OnboardingBanner({ trade }: { trade?: TradeKey }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-6 rounded-[20px] bg-[#1F3B2D] p-8 text-[#EFE6D4] sm:p-10 md:flex-row md:items-center">
        <div className="max-w-2xl space-y-2">
          <div style={{ letterSpacing: "0.2em" }} className="font-condensed-700 text-xs uppercase text-[#D8B47A]">Zero-tech onboarding &amp; direct phone support</div>
          <h2 className="font-condensed-800 text-3xl text-[#EFE6D4] sm:text-4xl">You don&apos;t need to be tech-savvy. We handle the whole setup.</h2>
          <p className="text-base text-[#EFE6D4]/90">We build your call flow, connect your calendar, test your line, and make changes for you whenever you want to adjust your hours or rates. Your customers keep calling the number they already have.</p>
        </div>
        <DemoButton trade={trade} className="shrink-0">Schedule your setup call</DemoButton>
      </div>
    </section>
  );
}
