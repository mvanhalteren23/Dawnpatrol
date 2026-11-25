// Client knowledge-base review link (pure; unit tested). The client opens a link (no login),
// fills in gaps, checks what we guessed, keeps or removes website suggestions, edits anything
// and adds what's missing. Their edits save straight away and are recorded in the history.

export const REVIEW_DAYS = 30;
export const MAX_CHANGES_PER_HOUR = 200;

export type ReviewKind = "fill" | "check" | "suggestion" | "live";
type Item = { id: string; category: string; title: string; content: string; tags: string; isActive: boolean };

const PLACEHOLDER = /^TO FILL IN/i;

/** Which section of the review page an entry belongs in. */
export function reviewKind(i: Item): ReviewKind {
  if (PLACEHOLDER.test(i.content.trim())) return "fill";
  if (/\bassumed\b/.test(i.tags)) return "check";
  if (!i.isActive) return "suggestion";
  return "live";
}

/** The hint shown for a "TO FILL IN" entry (the text after the marker), and an empty box. */
export function placeholderHint(content: string): string {
  return content.replace(PLACEHOLDER, "").replace(/^[:\s]+/, "").trim();
}

/**
 * How much callers need this answer (higher first): what a receptionist is asked on almost every
 * call comes before the occasional question. Matched on the title and hint, then the category.
 */
const TOPICS: { score: number; test: RegExp }[] = [
  { score: 100, test: /\b(hours?|open|opening|closed|closing|holiday|availability|weekend)/i },
  { score: 95, test: /\b(services?(?! area)|what (we|you) (do|sell|offer)|offer(ed|ings?)?|products?|specialt|jobs? (we|you) turn down|don'?t do)/i },
  { score: 90, test: /\b(service area|areas?|address|location|where|towns?|cities|parking|directions)/i },
  { score: 85, test: /\b(book(ing|ed)?|appointments?|schedul|estimates?|quotes?|consult|site visit|drop-?off|first (call|meeting))/i },
  { score: 80, test: /\b(prices?|pricing|cost|rates?|fees?|charge|free estimate|diagnostic)/i },
  { score: 78, test: /\b(emergenc|after[- ]hours|urgent|24\/7|same[- ]day)/i },
  { score: 65, test: /\b(who (handles|to call)|transfer|put through|supplier|partners?|lender|staff|owner|manager)/i },
  { score: 60, test: /\b(payment|pay|deposit|financing|invoice|credit card|e-?transfer)/i },
  { score: 55, test: /\b(warrant|guarantee|licen[cs]|insur|certif)/i },
  { score: 50, test: /\b(returns?|exchange|cancel|refund|policy|policies)/i },
];
const CATEGORY_SCORE: Record<string, number> = { HOURS: 100, SERVICE: 95, LOCATION: 90, PRICING: 80, STAFF: 65, POLICY: 50, FAQ: 45, SCRIPT: 40, OTHER: 30 };

export function reviewPriority(i: Pick<Item, "category" | "title" | "content">): number {
  const text = `${i.title} ${PLACEHOLDER.test(i.content.trim()) ? placeholderHint(i.content) : ""}`;
  const topic = TOPICS.find((t) => t.test.test(text))?.score ?? 0;
  return Math.max(topic, CATEGORY_SCORE[i.category] ?? 30);
}

/** Most needed first; ties: blanks before guesses, then by title. */
function byNeed<T extends Item>(a: T, b: T): number {
  return reviewPriority(b) - reviewPriority(a) || Number(reviewKind(b) === "fill") - Number(reviewKind(a) === "fill") || a.title.localeCompare(b.title);
}

export function groupForReview<T extends Item>(items: T[]): Record<ReviewKind, T[]> {
  const out: Record<ReviewKind, T[]> = { fill: [], check: [], suggestion: [], live: [] };
  for (const i of items) out[reviewKind(i)].push(i);
  out.fill.sort(byNeed);
  out.check.sort(byNeed);
  out.suggestion.sort(byNeed);
  out.live.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  return out;
}

/** Everything that needs the client's answer (gaps and guesses together), most needed first. */
export function neededForReview<T extends Item>(items: T[]): T[] {
  return items.filter((i) => { const k = reviewKind(i); return k === "fill" || k === "check"; }).sort(byNeed);
}

/** An entry once the client has saved it: confirmed, live, and no longer marked as a guess or draft. */
export function confirmedFields(existing: Pick<Item, "title" | "tags">, edited: { title: string; content: string }) {
  const tags = existing.tags.split(",").map((t) => t.trim()).filter((t) => t && t !== "assumed" && t !== "claude-draft");
  tags.push("client-reviewed");
  return {
    title: edited.title.replace(/\s*\(assumed\)\s*$/i, "").trim().slice(0, 200),
    content: edited.content.trim().slice(0, 4000),
    tags: [...new Set(tags)].join(","),
    isActive: true,
  };
}

export function linkState(l: { expiresAt: Date; revokedAt: Date | null }, now = new Date()): "active" | "expired" | "revoked" {
  if (l.revokedAt) return "revoked";
  return l.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
}

export function validToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(token);
}

/** An account's contacts as review-link recipients (anyone with an email or a mobile). */
export function reviewPeopleFrom(contacts: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }[]) {
  return contacts
    .filter((c) => c.email || c.phone)
    .map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "Contact", firstName: c.firstName ?? "", email: c.email, phone: c.phone }));
}
