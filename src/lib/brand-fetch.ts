import "server-only";
import { brandFromHtml } from "./email-brand";

// Read a client's website for their logo and brand colour (email branding). Public http(s) sites only.

function publicUrl(raw: string): URL | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return null;
    return u;
  } catch {
    return null;
  }
}

export async function fetchBrand(website: string): Promise<{ logoUrl: string | null; color: string | null }> {
  const url = publicUrl(website);
  if (!url) return { logoUrl: null, color: null };
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HeadAboveDigital/1.0; +https://www.headabovedigital.com)" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return { logoUrl: null, color: null };
  const html = (await res.text()).slice(0, 400_000);
  return brandFromHtml(html, res.url || url.toString());
}
