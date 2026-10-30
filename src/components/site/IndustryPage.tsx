import { INDUSTRIES, type TradeKey } from "@/lib/site-content";
import { DemoButton } from "./Demo";
import { DispatchSimulator } from "./DispatchSimulator";
import { OnboardingBanner, PricingSection } from "./Pricing";
import { Eyebrow, liveDemo } from "./Sections";

export async function IndustryPage({ trade }: { trade: TradeKey }) {
  const ind = INDUSTRIES[trade];
  const demo = await liveDemo();
  return (
    <>
      <section className="border-b-4 border-[#173022] bg-[#1F3B2D] py-14 text-[#EFE6D4] lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl space-y-6">
            <Eyebrow dark>{ind.eyebrow}</Eyebrow>
            <h1 style={{ lineHeight: 0.92 }} className="font-condensed-800 text-5xl text-[#EFE6D4] sm:text-6xl lg:text-[72px]">{ind.heroTitle}</h1>
            <p className="max-w-3xl text-lg font-medium leading-[28px] text-[#EFE6D4] sm:text-[18px]">{ind.heroSub}</p>
            <ul className="flex flex-wrap gap-2 pt-1">
              {ind.trustBadges.map((b) => <li key={b} className="rounded-[6px] border border-[#6B5A43] bg-[#173022] px-3 py-1.5 text-xs font-semibold text-[#EFE6D4]">✓ {b}</li>)}
            </ul>
            <div className="flex flex-wrap items-center gap-4 pt-3">
              <DemoButton trade={trade}>{ind.primaryCta}</DemoButton>
              {demo ? (
                <a href={`tel:${demo.tel}`} className="inline-flex h-[48px] items-center rounded-[12px] border-2 border-[#EFE6D4] px-6 text-sm font-semibold text-[#EFE6D4] hover:no-underline">Call our AI receptionist demo: {demo.label}</a>
              ) : null}
              <a href="#dispatch-simulator" className="text-sm font-semibold text-[#D8B47A] underline-offset-4 hover:underline">Hear a sample call</a>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10">
          <Eyebrow>Key pain points solved</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#1F3B2D] sm:text-[48px]">Stop dropping tools to answer the phone.</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {ind.painPoints.map((p, i) => (
            <div key={p.title} className="rounded-[12px] border-2 border-[#1F3B2D] bg-[#EFE6D4] p-6">
              <div className="font-condensed-700 mb-4 flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#1F3B2D] text-lg text-[#D8B47A]">0{i + 1}</div>
              <h3 className="font-condensed-700 mb-2 text-2xl leading-[1.05] text-[#1F3B2D]">{p.title}</h3>
              <p className="text-base leading-6 text-[#6B5A43]">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y-2 border-[#1F3B2D] bg-[#173022] py-16 text-[#EFE6D4]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <Eyebrow dark>How it works</Eyebrow>
            <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#EFE6D4] sm:text-[48px]">Four steps from first ring to booked job.</h2>
          </div>
          <ol className="grid gap-6 md:grid-cols-4">
            {ind.steps.map((s) => (
              <li key={s.step} className="space-y-3 rounded-[12px] border border-[#6B5A43] bg-[#1F3B2D] p-6">
                <div style={{ letterSpacing: "0.15em" }} className="font-condensed-700 text-xs uppercase text-[#D8B47A]">{s.step}</div>
                <div className="font-condensed-700 text-2xl text-[#EFE6D4]">{s.action}</div>
                <p className="text-sm leading-relaxed text-[#EFE6D4]/90">{s.outcome}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10">
          <Eyebrow>Purpose-built capabilities</Eyebrow>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#1F3B2D] sm:text-[48px]">{ind.featuresTitle}</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {ind.features.map((f) => (
            <div key={f.title} className="space-y-2 rounded-[12px] bg-[#1F3B2D] p-6 text-[#EFE6D4] sm:p-8">
              <h3 className="font-condensed-700 text-[28px] leading-[1.05] text-[#D8B47A]">{f.title}</h3>
              <p className="text-base leading-6 text-[#EFE6D4]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <DispatchSimulator initialTrade={trade} />
      <PricingSection tierName={ind.tierName} trade={trade} />
      <OnboardingBanner trade={trade} />
    </>
  );
}
