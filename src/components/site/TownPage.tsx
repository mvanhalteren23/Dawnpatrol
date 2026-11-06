import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PRICES, PRICING, type TradeKey } from "@/lib/site-content";
import { faqJsonLd, jsonLdScript, townBySlug, townPage } from "@/lib/seo";
import { IndustryPage } from "./IndustryPage";

// A trade's page for one BC town (e.g. /contractors/vancouver): the trade page with local copy.

export async function townMetadata(trade: TradeKey, params: Promise<{ town: string }>): Promise<Metadata> {
  const town = townBySlug((await params).town);
  if (!town) return {};
  const p = townPage(trade, town);
  return { title: `${p.title} | Head Above Digital`, description: p.description, alternates: { canonical: p.path } };
}

export async function TownPage({ trade, params }: { trade: TradeKey; params: Promise<{ town: string }> }) {
  const town = townBySlug((await params).town);
  if (!town) notFound();
  const p = townPage(trade, town);
  const faq = [
    town.faq,
    { q: `How much does it cost for ${p.noun} ${town.where}?`, a: `The same everywhere in BC: CA$${PRICES.CAD.monthly} a month plus GST/HST, with ${PRICING.includedMinutes} minutes included and no setup fee. ${PRICING.minimumMonths}-month minimum, then cancel any time.` },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd(faq)) }} />
      <IndustryPage trade={trade} local={{ h1: p.h1, townName: town.name, region: town.region, areaCodes: town.areaCodes, intro: town.intro, local: town.local, faq }} />
    </>
  );
}
