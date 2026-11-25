import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { DemoProvider } from "@/components/site/Demo";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { CurrencyProvider } from "@/components/site/Currency";
import { DEFAULT_CURRENCY } from "@/lib/site-content";
import { businessJsonLd, jsonLdScript } from "@/lib/seo";
import { demoBookingPath, liveDemo } from "@/components/site/Sections";
import { ELEVENLABS_GRANT_LOGO } from "@/lib/site-content";

// The public website (Brand Kit, October 2026). The CRM and client portal keep their own layouts.

// "Hear it answer as your business" builds the demo agent after responding (research + setup).
export const maxDuration = 300;
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const session = await getSession().catch(() => null);
  const [demo, bookingPath] = await Promise.all([liveDemo(), demoBookingPath()]);
  const account = session ? { href: session.role === "CLIENT" ? "/portal" : "/crm", label: "Open dashboard" } : { href: "/login?next=/portal", label: "Client login" };
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" precedence="default" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(businessJsonLd({ telephone: demo?.tel ?? null })) }} />
      <CurrencyProvider initial={DEFAULT_CURRENCY}>
      <DemoProvider bookingPath={bookingPath}>
        <div className="font-barlow flex min-h-screen flex-col bg-[#EFE6D4] text-[#1F3B2D] selection:bg-[#1F3B2D] selection:text-[#EFE6D4]">
          <SiteHeader account={account} />
          <main className="flex-1">{children}</main>
          <SiteFooter account={account} grantLogo={ELEVENLABS_GRANT_LOGO} />
        </div>
      </DemoProvider>
      </CurrencyProvider>
    </>
  );
}
