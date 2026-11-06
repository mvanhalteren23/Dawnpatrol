import { describe, expect, it } from "vitest";
import { businessJsonLd, GUIDES, jsonLdScript, sitemapEntries, SITE_URL, TOWNS, townBySlug, townPage } from "@/lib/seo";

describe("seo", () => {
  it("lists every public page once, on the canonical address", () => {
    const urls = sitemapEntries().map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/contractors/vancouver`);
    expect(urls).toContain(`${SITE_URL}/auto-repair/kelowna`);
    expect(urls).toContain(`${SITE_URL}/guides/${GUIDES[0]!.slug}`);
    expect(urls).toHaveLength(1 + 3 * (1 + TOWNS.length) + 1 + GUIDES.length + 3);
    expect(urls.every((u) => u.startsWith("https://www.headabovedigital.com"))).toBe(true);
    expect(urls.some((u) => /\/(crm|portal|api|login)/.test(u))).toBe(false);
  });

  it("builds town pages with their own title and path", () => {
    const p = townPage("contractors", townBySlug("sunshine-coast")!);
    expect(p.path).toBe("/contractors/sunshine-coast");
    expect(p.title).toBe("AI Receptionist for Contractors on the Sunshine Coast");
    expect(p.h1).toBe("An AI receptionist for contractors and trades on the Sunshine Coast.");
    expect(townBySlug("nowhere")).toBeNull();
    expect(new Set(TOWNS.map((t) => t.intro)).size).toBe(TOWNS.length);
  });

  it("states facts only in the business data (no ratings), and is safe inside a script tag", () => {
    const data = businessJsonLd({ telephone: "+16049668897" });
    expect(data.telephone).toBe("+16049668897");
    expect(JSON.stringify(data)).not.toContain("aggregateRating");
    expect(jsonLdScript({ x: "</script><script>" })).not.toContain("</script>");
  });
});
