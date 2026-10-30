"use client";
import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { submitDemoRequest, type DemoRequestState } from "@/app/site-actions";
import { INDUSTRIES, TRADE_KEYS, type TradeKey } from "@/lib/site-content";

// "Book a demo" anywhere on the site opens one form, pre-set to the page's trade. It goes into the
// CRM as an inbound account with a call-back task, and you get an email.

const DemoContext = createContext<(trade?: TradeKey) => void>(() => undefined);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState<TradeKey>("contractors");
  const openDemo = (t?: TradeKey) => {
    if (t) setTrade(t);
    setOpen(true);
  };
  return (
    <DemoContext.Provider value={openDemo}>
      {children}
      {open ? <DemoModal trade={trade} onClose={() => setOpen(false)} /> : null}
    </DemoContext.Provider>
  );
}

export function DemoButton({ trade, children, variant = "tan", className = "" }: { trade?: TradeKey; children: ReactNode; variant?: "tan" | "green"; className?: string }) {
  const openDemo = useContext(DemoContext);
  const colors = variant === "tan" ? { backgroundColor: "#D8B47A", color: "#1F3B2D" } : { backgroundColor: "#1F3B2D", color: "#EFE6D4" };
  return (
    <button type="button" onClick={() => openDemo(trade)} style={colors} className={`h-[48px] cursor-pointer rounded-[12px] px-6 text-sm font-semibold transition-opacity hover:opacity-90 ${className}`}>
      {children}
    </button>
  );
}

const inputClass = "w-full h-11 px-3 rounded-[6px] border-2 border-[#6B5A43] bg-[#EFE6D4] text-sm text-[#1F3B2D] focus:outline-none focus:border-[#1F3B2D]";

function DemoModal({ trade, onClose }: { trade: TradeKey; onClose: () => void }) {
  const [state, action, pending] = useActionState<DemoRequestState | undefined, FormData>(submitDemoRequest, undefined);
  const [started] = useState(() => Date.now());
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    dialog.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{ backgroundColor: "rgba(23, 48, 34, 0.85)" }} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="demo-title" className="relative w-full max-w-lg space-y-5 rounded-[20px] border-2 border-[#1F3B2D] bg-[#EFE6D4] p-6 text-[#1F3B2D] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div style={{ color: "#A87A33", letterSpacing: "0.2em" }} className="font-condensed-700 text-xs uppercase">White-glove onboarding &amp; demo</div>
            <h3 id="demo-title" className="font-condensed-800 mt-1 text-3xl leading-none text-[#1F3B2D]">Ready to streamline your front desk?</h3>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer px-2 py-1 text-xl font-bold text-[#6B5A43]" aria-label="Close">✕</button>
        </div>

        {state?.ok ? (
          <div className="space-y-3 rounded-[12px] bg-[#1F3B2D] p-6 text-[#EFE6D4]">
            <div className="font-condensed-700 text-xl uppercase text-[#D8B47A]">✓ Demo request received</div>
            <p className="text-sm leading-relaxed">
              Thanks, <strong>{state.name || "friend"}</strong>. We&apos;ll call <strong>{state.phone || "you"}</strong> within one business day to book your demo{state.business ? <> and set up a live test call for <strong>{state.business}</strong></> : null}.
            </p>
            <button type="button" onClick={onClose} className="mt-2 h-[48px] cursor-pointer rounded-[12px] bg-[#D8B47A] px-5 text-sm font-semibold text-[#1F3B2D]">Back to site</button>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="started" value={started} />
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
              <label>Leave this empty <input name="company_website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Your name *<input name="name" required maxLength={120} placeholder="e.g. Matt" className={`${inputClass} mt-1`} /></label>
              <label className="block text-sm font-semibold">Shop / business name *<input name="business" required maxLength={160} placeholder="e.g. Atwell Peak Contracting" className={`${inputClass} mt-1`} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Industry / trade
                <select name="trade" defaultValue={trade} className={`${inputClass} mt-1`}>
                  {TRADE_KEYS.map((k) => <option key={k} value={k}>{INDUSTRIES[k].tabLabel}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Direct phone number *<input name="phone" type="tel" required maxLength={40} placeholder="(604) 555-0199" className={`${inputClass} mt-1`} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Shop location / city<input name="location" maxLength={120} placeholder="e.g. Squamish, BC" className={`${inputClass} mt-1`} /></label>
              <label className="block text-sm font-semibold">Preferred setup date<input name="preferredDate" type="date" className={`${inputClass} mt-1`} /></label>
            </div>
            <label className="block text-sm font-semibold">Email (optional)<input name="email" type="email" maxLength={200} placeholder="you@yourshop.ca" className={`${inputClass} mt-1`} /></label>
            {state?.error ? <p role="alert" className="text-sm font-semibold text-[#A8401F]">{state.error}</p> : null}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="h-[48px] cursor-pointer rounded-[12px] border-2 border-[#1F3B2D] px-5 text-sm font-semibold text-[#1F3B2D]">Cancel</button>
              <button type="submit" disabled={pending} className="h-[48px] cursor-pointer rounded-[12px] bg-[#1F3B2D] px-6 text-sm font-semibold text-[#EFE6D4] disabled:opacity-60">{pending ? "Sending…" : "Book my live demo"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
