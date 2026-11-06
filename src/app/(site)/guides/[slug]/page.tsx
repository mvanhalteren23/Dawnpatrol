import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUSINESS, faqJsonLd, guideBySlug, GUIDES, jsonLdScript, SITE_URL } from "@/lib/seo";
import { DemoButton } from "@/components/site/Demo";
import { Eyebrow } from "@/components/site/Sections";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = guideBySlug((await params).slug);
  if (!g) return {};
  return { title: `${g.title} | Head Above Digital`, description: g.description, alternates: { canonical: `/guides/${g.slug}` }, openGraph: { type: "article", title: g.title, description: g.description } };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = guideBySlug((await params).slug);
  if (!g) notFound();
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.description,
    dateModified: g.updated,
    datePublished: g.updated,
    mainEntityOfPage: `${SITE_URL}/guides/${g.slug}`,
    author: { "@type": "Organization", name: BUSINESS.name, url: `${SITE_URL}/` },
    publisher: { "@id": `${SITE_URL}/#business` },
  };
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(article) }} />
      {g.faq.length ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd(g.faq)) }} /> : null}
      <Link href="/guides" className="text-sm font-semibold text-[#A87A33]">← All guides</Link>
      <div className="mt-4"><Eyebrow>Guide · updated {g.updated}</Eyebrow></div>
      <h1 style={{ lineHeight: 0.98 }} className="font-condensed-800 mb-4 text-4xl text-[#1F3B2D] sm:text-[52px]">{g.title}</h1>
      <p className="mb-10 text-lg leading-7 text-[#6B5A43]">{g.description}</p>
      {g.sections.map((s) => (
        <section key={s.h} className="mb-8">
          <h2 className="font-condensed-700 mb-3 text-3xl text-[#1F3B2D]">{s.h}</h2>
          {s.p.map((t, i) => <p key={i} className="mb-3 text-base leading-7 text-[#2C3A30]">{t}</p>)}
        </section>
      ))}
      {g.faq.length ? (
        <section className="mb-10 rounded-[12px] border-2 border-[#1F3B2D] bg-[#F7F2E8] p-6">
          <h2 className="font-condensed-700 mb-4 text-3xl text-[#1F3B2D]">Common questions</h2>
          <dl className="space-y-4">
            {g.faq.map((f) => <div key={f.q}><dt className="font-semibold text-[#1F3B2D]">{f.q}</dt><dd className="mt-1 text-[#6B5A43]">{f.a}</dd></div>)}
          </dl>
        </section>
      ) : null}
      <div className="rounded-[12px] bg-[#1F3B2D] p-6 text-[#EFE6D4] sm:p-8">
        <h2 className="font-condensed-700 mb-2 text-3xl text-[#D8B47A]">Hear one built for your business.</h2>
        <p className="mb-4 text-base">A free demo: an AI receptionist answering with your business name, services and hours.</p>
        <DemoButton>Book a demo</DemoButton>
      </div>
    </article>
  );
}
