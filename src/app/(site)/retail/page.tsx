import type { Metadata } from "next";
import { INDUSTRIES } from "@/lib/site-content";
import { IndustryPage } from "@/components/site/IndustryPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${INDUSTRIES.retail.seo.title} | Head Above Digital`,
  description: INDUSTRIES.retail.seo.description,
  alternates: { canonical: INDUSTRIES.retail.path },
};

export default function Page() {
  return <IndustryPage trade="retail" />;
}
