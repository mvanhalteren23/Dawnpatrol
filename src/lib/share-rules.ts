// "Share to Head Above" (pure; unit tested): turn what Google Maps or Chrome shares into the
// details of a new account. Maps shares "Name\nAddress\nhttps://maps.app.goo.gl/…"; Chrome
// shares the page title and its address (often inside the text, not the url field).

export type SharedBusiness = {
  name: string;
  website: string | null; // the business's own site (not Maps, Facebook, Yelp…)
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  mapsUrl: string | null;
  otherUrl: string | null; // a directory or social page, kept in the notes
};

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const REGION = "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const CITY_RE = new RegExp(`(?:^|,)\\s*([A-Za-z][A-Za-z .'-]{1,40}?),\\s*(${REGION})\\b(?:\\s+[A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d|\\s+\\d{5}(?:-\\d{4})?)?`);
const NOT_A_WEBSITE = /(^|\.)(google\.[a-z.]+|goo\.gl|facebook\.com|fb\.com|instagram\.com|yelp\.[a-z.]+|linkedin\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|yellowpages\.ca|yellowpages\.com|bbb\.org|homestars\.com|houzz\.[a-z.]+|nextdoor\.com|tripadvisor\.[a-z.]+|kijiji\.ca)$/i;

export function isMapsUrl(u: string): boolean {
  try {
    const { hostname, pathname } = new URL(u);
    return hostname === "maps.app.goo.gl" || (hostname === "goo.gl" && pathname.startsWith("/maps")) || (/(^|\.)google\.[a-z.]+$/.test(hostname) && pathname.startsWith("/maps")) || hostname.startsWith("maps.google.");
  } catch {
    return false;
  }
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Page titles like "Sea to Sky Auto | Squamish Mechanic" → "Sea to Sky Auto". */
export function nameFromTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  // The first part that isn't a generic page name ("Home - Peak Heating" → "Peak Heating").
  const parts = t.split(/\s+[|–—·•:-]\s+/).map((p) => p.trim()).filter(Boolean);
  const generic = /^(home|home page|homepage|welcome|about|about us|contact|contact us|services)$/i;
  const first = parts.find((p) => !generic.test(p)) ?? t;
  const cleaned = first.replace(/^(welcome to|welcome)\s+/i, "").trim();
  return (cleaned.length >= 2 ? cleaned : t).slice(0, 120);
}

/** A line that is a phone number (not a name that happens to contain digits). */
function isPhoneLine(line: string): boolean {
  return PHONE_RE.test(line) && line.replace(PHONE_RE, "").replace(/[^a-z]/gi, "").length < 4;
}

/** Looks like a street address: a number and a street word, or a postal / ZIP code. */
function looksLikeAddress(line: string): boolean {
  return /\d/.test(line) && (/\b(st|street|ave|avenue|rd|road|hwy|highway|blvd|dr|drive|way|cres|crescent|pl|place|ln|lane|ct|court|unit|suite|#)\b/i.test(line) || /[A-Z]\d[A-Z]\s?\d[A-Z]\d/.test(line) || /\b\d{5}\b/.test(line));
}

export function parseShare(input: { title?: string | null; text?: string | null; url?: string | null }): SharedBusiness {
  const title = (input.title ?? "").trim();
  const text = (input.text ?? "").replace(/\r/g, "").trim();
  const urls = [...new Set([...(input.url ? [input.url.trim()] : []), ...(text.match(URL_RE) ?? [])].map((u) => u.replace(/[).,]+$/, "")))];
  const mapsUrl = urls.find(isMapsUrl) ?? null;
  const pages = urls.filter((u) => !isMapsUrl(u));
  const website = pages.find((u) => {
    const h = hostOf(u);
    return h != null && !NOT_A_WEBSITE.test(h);
  }) ?? null;
  const otherUrl = pages.find((u) => u !== website) ?? null;

  // The text without links, split into lines (Maps sometimes joins them with " · ").
  const lines = text.replace(URL_RE, "").split(/\n|\s+·\s+/).map((l) => l.trim()).filter(Boolean);
  // Google Maps always puts the business name first, then the address.
  const mapsName = mapsUrl && lines[0] && !isPhoneLine(lines[0]) ? lines[0] : null;
  const rest = mapsName ? lines.slice(1) : lines;
  const address = rest.find(looksLikeAddress) ?? null;
  const phoneLine = rest.find(isPhoneLine) ?? rest.find((l) => l !== address && PHONE_RE.test(l));
  const phoneMatch = phoneLine?.match(PHONE_RE);
  const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : null;

  let name = mapsName ?? "";
  if (!name && title) name = nameFromTitle(title);
  if (!name) name = rest.find((l) => l !== address && !isPhoneLine(l)) ?? "";
  if (!name && website) name = hostOf(website) ?? "";
  name = name.replace(/^["“]|["”]$/g, "").trim().slice(0, 120);

  const where = address ?? lines.join(", ");
  const m = where.match(CITY_RE);
  return { name, website, phone, address, city: m?.[1]?.trim() ?? null, state: m?.[2] ?? null, mapsUrl, otherUrl };
}
