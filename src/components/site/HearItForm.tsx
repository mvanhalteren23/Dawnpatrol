"use client";
import { useActionState, useState } from "react";
import { requestPersonalDemo, type PersonalDemoState } from "@/app/site-actions";
import { INDUSTRIES, TRADE_KEYS, type TradeKey } from "@/lib/site-content";
import { Eyebrow } from "./Eyebrow";

const inputClass = "mt-1 h-12 w-full rounded-[6px] border-2 border-[#6B5A43] bg-[#EFE6D4] px-3 text-base text-[#1F3B2D] focus:border-[#D8B47A] focus:outline-none";

/** "Hear it answer as your business": we build their receptionist and text them the number. */
export function HearItForm({ trade = "contractors", demoLine }: { trade?: TradeKey; demoLine?: string | null }) {
  const [state, action, pending] = useActionState<PersonalDemoState | undefined, FormData>(requestPersonalDemo, undefined);
  const [started] = useState(() => Date.now());
  return (
    <section id="hear-it" className="scroll-mt-24 bg-[#D8B47A] py-16 text-[#1F3B2D]">
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="space-y-4 lg:col-span-5">
          <Eyebrow>Free, no call needed</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl sm:text-[52px]">Hear it answer as your business.</h2>
          <p className="text-[18px] font-medium leading-[28px]">Tell us your business and we&apos;ll build a receptionist that knows your services, hours and service area from your website. We text you a number to call, usually within 15 minutes and always within the hour.</p>
          <ol className="space-y-2 text-base font-medium">
            <li>1. We read your website and public listing.</li>
            <li>2. We build your receptionist in your business&apos;s name.</li>
            <li>3. You call it and ask what your customers ask.</li>
          </ol>
          {demoLine ? <p className="text-sm">Can&apos;t wait? Call our own receptionist now: <a href={`tel:${demoLine.replace(/[^0-9+]/g, "")}`} className="font-bold text-[#1F3B2D] underline">{demoLine}</a></p> : null}
        </div>
        <div className="rounded-[20px] border-2 border-[#1F3B2D] bg-[#1F3B2D] p-6 text-[#EFE6D4] sm:p-8 lg:col-span-7">
          {state?.ok ? (
            <div className="space-y-3" role="status">
              <div className="font-condensed-800 text-3xl text-[#D8B47A]">{state.ready ? "Your demo is ready." : "We're building it now."}</div>
              <p className="text-base leading-relaxed">
                {state.ready
                  ? <>We just texted <strong>{state.phone}</strong> the number and extension for {state.business ? <strong>{state.business}</strong> : "your business"}&apos;s receptionist. Give it a call.</>
                  : <>Thanks{state.name ? `, ${state.name.split(" ")[0]}` : ""}. We&apos;re reading up on {state.business ? <strong>{state.business}</strong> : "your business"} and setting up your receptionist. We&apos;ll text <strong>{state.phone}</strong> the number to call as soon as it&apos;s ready, usually within 15 minutes.</>}
              </p>
              <p className="text-sm text-[#EFE6D4]/80">Try asking it about your hours, what you do and don&apos;t do, your service area, or to book a time.</p>
            </div>
          ) : (
            <form action={action} className="space-y-4">
              <input type="hidden" name="started" value={started} />
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden"><label>Leave this empty <input name="company_website" tabIndex={-1} autoComplete="off" /></label></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Business name<input name="business" required maxLength={160} autoComplete="organization" placeholder="e.g. Atwell Peak Contracting" className={inputClass} /></label>
                <label className="block text-sm font-semibold">Type of business
                  <select name="trade" defaultValue={trade} className={inputClass}>
                    {TRADE_KEYS.map((k) => <option key={k} value={k}>{INDUSTRIES[k].tabLabel}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Website<input name="website" inputMode="url" maxLength={300} placeholder="yourbusiness.ca" className={inputClass} /></label>
                <label className="block text-sm font-semibold">Town<input name="city" maxLength={120} autoComplete="address-level2" placeholder="e.g. Squamish, BC" className={inputClass} /></label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Your name<input name="name" required maxLength={120} autoComplete="name" className={inputClass} /></label>
                <label className="block text-sm font-semibold">Mobile (we text the demo here)<input name="phone" type="tel" required inputMode="tel" maxLength={40} autoComplete="tel" placeholder="(604) 555-0199" className={inputClass} /></label>
              </div>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5 shrink-0 accent-[#D8B47A]" /><span>Text me the demo number, and follow up with me about it (by phone or text, including by an AI assistant). Reply STOP any time.</span></label>
              {state?.error ? <p role="alert" className="text-sm font-semibold text-[#D8B47A]">{state.error}</p> : null}
              <button type="submit" disabled={pending} className="h-[52px] w-full cursor-pointer rounded-[12px] bg-[#D8B47A] px-6 text-base font-semibold text-[#1F3B2D] disabled:opacity-60 sm:w-auto">{pending ? "Sending…" : "Build my demo receptionist"}</button>
              <p className="text-xs text-[#EFE6D4]/70">No website? Add your town and we&apos;ll use your Google listing. It&apos;s a demo: nothing changes on your phone line.</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
