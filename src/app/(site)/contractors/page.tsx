import type { Metadata } from "next";
import { INDUSTRIES } from "@/lib/site-content";
import { IndustryPage } from "@/components/site/IndustryPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${INDUSTRIES.contractors.seo.title} | Head Above Digital`,
  description: INDUSTRIES.contractors.seo.description,
  alternates: { canonical: INDUSTRIES.contractors.path },
};

export default function Page() {
  return <IndustryPage trade="contractors" />;
}
