import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/seo";

// /sitemap.xml: every public page (submit it in Google Search Console).
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
