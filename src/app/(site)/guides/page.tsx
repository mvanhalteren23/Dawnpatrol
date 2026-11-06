import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/lib/seo";
import { Eyebrow } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: "Guides for Canadian Small Business Owners | Head Above Digital",
  description: "Plain answers on phone answering, AI receptionists, keeping your number and what a receptionist really costs a small business.",
  alternates: { canonical: "/guides" },
};

export default function Guides() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <Eyebrow>Guides</Eyebrow>
      <h1 style={{ lineHeight: 0.95 }} className="font-condensed-800 mb-10 text-4xl text-[#1F3B2D] sm:text-[56px]">Answers for owners who are too busy to answer the phone.</h1>
      <ul className="space-y-6">
        {GUIDES.map((g) => (
          <li key={g.slug} className="rounded-[12px] border-2 border-[#1F3B2D] bg-[#F7F2E8] p-6">
            <Link href={`/guides/${g.slug}`} className="font-condensed-700 text-2xl text-[#1F3B2D] hover:no-underline">{g.title}</Link>
            <p className="mt-2 text-base leading-6 text-[#6B5A43]">{g.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
