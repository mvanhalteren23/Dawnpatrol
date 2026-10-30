"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { INDUSTRIES, type TradeKey } from "@/lib/site-content";
import { BrandLogo } from "./BrandLogo";
import { DemoButton } from "./Demo";

const NAV = [
  { href: "/", label: "Home Overview", short: "Overview" },
  ...Object.values(INDUSTRIES).map((i) => ({ href: i.path, label: i.tabLabel, short: i.shortLabel })),
];

function tradeFor(path: string): TradeKey | undefined {
  return Object.values(INDUSTRIES).find((i) => i.path === path)?.id;
}

export function SiteHeader({ account }: { account: { href: string; label: string } }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[#173022] bg-[#1F3B2D]">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="hover:no-underline" aria-label="Head Above Digital home"><BrandLogo /></Link>
        <nav aria-label="Industry solutions" className="hidden items-center gap-2 lg:flex">
          {NAV.map((n) => {
            const active = path === n.href;
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} style={{ backgroundColor: active ? "#173022" : "transparent", borderColor: active ? "#D8B47A" : "transparent" }} className="rounded-[12px] border-2 px-3.5 py-2 text-sm font-semibold text-[#EFE6D4] transition-colors hover:bg-[#173022] hover:no-underline">
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <Link href={account.href} className="hidden px-2 text-sm font-semibold text-[#EFE6D4] hover:text-[#D8B47A] hover:no-underline sm:inline">{account.label}</Link>
          <DemoButton trade={tradeFor(path)} className="px-5">Book a demo</DemoButton>
        </div>
      </div>
      <nav aria-label="Industry solutions" className="flex gap-2 overflow-x-auto border-t border-[#1F3B2D] bg-[#173022] px-4 py-2 lg:hidden">
        {NAV.map((n) => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} style={{ backgroundColor: active ? "#1F3B2D" : "transparent", color: active ? "#D8B47A" : "#EFE6D4", borderColor: active ? "#D8B47A" : "transparent" }} className="whitespace-nowrap rounded-[6px] border px-3 py-1.5 text-xs font-semibold hover:no-underline">
              {n.short}
            </Link>
          );
        })}
        <Link href={account.href} className="whitespace-nowrap rounded-[6px] border border-transparent px-3 py-1.5 text-xs font-semibold text-[#EFE6D4] hover:no-underline sm:hidden">{account.label}</Link>
      </nav>
    </header>
  );
}

export function SiteFooter({ account }: { account: { href: string; label: string } }) {
  return (
    <footer className="border-t-2 border-[#1F3B2D] bg-[#173022] py-12 text-[#EFE6D4]">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div className="space-y-2">
          <BrandLogo />
          <p className="text-xs text-[#EFE6D4]/70">Voice AI for the trades. Every call answered, every job booked.</p>
          <p className="text-xs text-[#EFE6D4]/70">Questions or support: <a href="mailto:team@headabovedigital.com" className="text-[#D8B47A]">team@headabovedigital.com</a></p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-6 text-sm font-semibold">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="text-[#EFE6D4] hover:text-[#D8B47A] hover:no-underline">{n.short === "Overview" ? "Overview" : n.label}</Link>)}
          <Link href={account.href} className="text-[#EFE6D4] hover:text-[#D8B47A] hover:no-underline">{account.label}</Link>
        </nav>
      </div>
    </footer>
  );
}
