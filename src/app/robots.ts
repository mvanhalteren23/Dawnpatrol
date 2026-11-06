import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// /robots.txt: the public website is indexed; the CRM, portal, booking pages and APIs aren't.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/crm", "/portal", "/api/", "/login", "/book/", "/audit-report/", "/lead-received"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
