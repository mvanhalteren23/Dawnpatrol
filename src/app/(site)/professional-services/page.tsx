import type { Metadata } from "next";
import { INDUSTRIES } from "@/lib/site-content";
import { IndustryPage } from "@/components/site/IndustryPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${INDUSTRIES.professionals.seo.title} | Head Above Digital`,
  description: INDUSTRIES.professionals.seo.description,
  alternates: { canonical: INDUSTRIES.professionals.path },
};

export default function Page() {
  return <IndustryPage trade="professionals" />;
}
