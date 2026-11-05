"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { CURRENCIES, FOLLOWUP_ADDON_PRICE, formatMoney, PRICES, type Currency } from "@/lib/site-content";

// The website's CAD/USD toggle. The first currency comes from the visitor's country (server); a
// choice they make is remembered in this browser.

const KEY = "hab.currency";
const CurrencyContext = createContext<{ currency: Currency; setCurrency: (c: Currency) => void }>({ currency: "CAD", setCurrency: () => {} });

export function CurrencyProvider({ initial, children }: { initial: Currency; children: ReactNode }) {
  const [currency, setState] = useState<Currency>(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "CAD" || saved === "USD") setState(saved);
    } catch {
      // storage blocked: keep the country default
    }
  }, []);
  const setCurrency = (c: Currency) => {
    setState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // ignore
    }
  };
  return <CurrencyContext.Provider value={{ currency, setCurrency }}>{children}</CurrencyContext.Provider>;
}

export const useCurrency = () => useContext(CurrencyContext);

export function CurrencyToggle({ dark = false }: { dark?: boolean }) {
  const { currency, setCurrency } = useCurrency();
  return (
    <div role="group" aria-label="Currency" className={`inline-flex rounded-[8px] border p-0.5 text-xs font-bold ${dark ? "border-[#6B5A43] bg-[#173022]" : "border-[#1F3B2D] bg-[#EFE6D4]"}`}>
      {CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={currency === c}
          onClick={() => setCurrency(c)}
          className={`cursor-pointer rounded-[6px] px-3 py-1 ${currency === c ? "bg-[#D8B47A] text-[#1F3B2D]" : dark ? "text-[#EFE6D4]" : "text-[#1F3B2D]"}`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/** A price in the visitor's currency: the plan, an extra minutes block, or the Follow-Up add-on. */
export function Price({ kind, times = 1, plus = 0 }: { kind: "monthly" | "block" | "addon"; times?: number; plus?: number }) {
  const { currency } = useCurrency();
  const base = kind === "monthly" ? PRICES[currency].monthly : kind === "block" ? PRICES[currency].blockPrice : FOLLOWUP_ADDON_PRICE?.[currency] ?? 0;
  return <>{formatMoney(currency, base * times + plus)}</>;
}

export function CurrencyName() {
  const { currency } = useCurrency();
  return <>{PRICES[currency].name}</>;
}
