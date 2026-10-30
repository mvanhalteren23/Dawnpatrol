import type { Metadata } from "next";
import { INDUSTRIES } from "@/lib/site-content";
import { IndustryPage } from "@/components/site/IndustryPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${INDUSTRIES.mechanics.seo.title} | Head Above Digital`,
  description: INDUSTRIES.mechanics.seo.description,
  alternates: { canonical: INDUSTRIES.mechanics.path },
};

export default function Page() {
  return <IndustryPage trade="mechanics" />;
}
