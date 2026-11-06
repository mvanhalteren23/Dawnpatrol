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

export function groupForReview<T extends Item>(items: T[]): Record<ReviewKind, T[]> {
  const out: Record<ReviewKind, T[]> = { fill: [], check: [], suggestion: [], live: [] };
  for (const i of items) out[reviewKind(i)].push(i);
  out.live.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  return out;
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
