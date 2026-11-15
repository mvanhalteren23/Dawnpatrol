"use client";
// Phone navigation for the CRM (and the Android app): a slim top bar plus a bottom tab bar within
// thumb reach on a 6.3" screen (designed at Pixel 10 Pro size, 410×914 CSS px). The four most-used
// places get tabs; everything else is one tap away under "More". Hidden from tablet width up,
// where the sidebar shows instead.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/site/BrandLogo";

export type NavItem = [href: string, label: string, short: string];

const TABS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/crm", label: "Home", icon: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  { href: "/crm/accounts", label: "Accounts", icon: <><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M2 21h20" /></> },
  { href: "/crm/health", label: "Health", icon: <path d="M3 12h4l2-5 4 10 2-5h6" /> },
  { href: "/crm/dialer", label: "Dialer", icon: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /> },
];

function isActive(path: string, href: string) {
  return href === "/crm" ? path === "/crm" : path === href || path.startsWith(`${href}/`);
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function MobileNav({ nav, email, role, company }: { nav: NavItem[]; email: string; role: string; company: string }) {
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  const current = nav.find(([href]) => href !== "/crm" && isActive(path, href)) ?? nav.find(([href]) => href === path);
  const moreActive = !TABS.some((t) => isActive(path, t.href));

  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-dawn-900 px-4 pt-[env(safe-area-inset-top)] md:hidden">
        <BrandMark size={28} />
        <span className="font-condensed text-base font-extrabold uppercase tracking-wide text-dawn-100">{current && current[0] !== "/crm" ? current[1] : company === "Head Above Digital" ? "Head Above" : company}</span>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-dawn-900 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {TABS.map((t) => {
            const on = isActive(path, t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium hover:no-underline ${on ? "text-dawn-400" : "text-dawn-100/80"}`}
                >
                  <span className={`flex h-8 w-14 items-center justify-center rounded-full ${on ? "bg-white/10" : ""}`}>
                    <Icon>{t.icon}</Icon>
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className={`flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${moreActive ? "text-dawn-400" : "text-dawn-100/80"}`}
            >
              <span className={`flex h-8 w-14 items-center justify-center rounded-full ${moreActive ? "bg-white/10" : ""}`}>
                <Icon><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="All pages">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-dawn-900 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <ul className="grid grid-cols-2 gap-2">
              {nav.map(([href, label]) => {
                const on = isActive(path, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={`flex min-h-12 items-center rounded-2xl px-4 py-3 text-sm font-medium hover:no-underline ${on ? "bg-dawn-400 text-dawn-900" : "bg-white/5 text-dawn-100"}`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-dawn-100/80">
              <div className="min-w-0">
                <div className="truncate">{email}</div>
                <div className="text-dawn-400">{role}</div>
              </div>
              <form action="/api/auth/logout" method="post">
                <button className="min-h-11 rounded-full border border-white/20 px-4 text-sm text-dawn-100">Sign out</button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
