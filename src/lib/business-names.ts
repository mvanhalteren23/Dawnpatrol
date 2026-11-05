// Business-name matching helpers (pure).

/** "Acme Plumbing Ltd." -> "acme plumbing" for loose name matching. */
export function normalizeBusinessName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\b(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|the)\b/g, " ").replace(/\s+/g, " ").trim();
}
