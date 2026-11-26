// What the CRM already knows about a business, what's still missing from its company profile, and
// the prompts that research only the gaps ("gaps") or re-check what's known ("update").
// Pure; unit tested.

export type ProfileItemKey = "website" | "phone" | "address" | "services" | "hours" | "team" | "people" | "rating" | "social" | "reach";

export const PROFILE_ITEMS: { key: ProfileItemKey; label: string }[] = [
  { key: "website", label: "Official website" },
  { key: "phone", label: "Main phone number" },
  { key: "address", label: "Street address, city and province/state" },
  { key: "services", label: "What they do (industry), services offered and service area" },
  { key: "hours", label: "Business hours" },
  { key: "team", label: "Years in business and approximate team size" },
  { key: "people", label: "Owner or decision makers with titles, and any business email or phone published for them" },
  { key: "rating", label: "Google rating and review count" },
  { key: "social", label: "Social media profiles" },
  { key: "reach", label: "How customers reach them today: online booking, after-hours answering, chat" },
];

export type KnownInput = {
  account: { name: string; website: string | null; phone: string | null; city: string | null; state: string | null; industry: string | null; employees: number | null; notes: string };
  contacts: { firstName: string | null; lastName: string | null; title: string | null; email: string | null; phone: string | null }[];
  /** Earlier research write-ups (newest first) and their extracted summaries. */
  reports: string[];
  summaries: { keyFacts?: string[]; decisionMakers?: { name: string; title: string | null }[] }[];
};

const UNKNOWN = /\b(unknown|not (found|listed|stated|published|available)|couldn'?t (find|verify|confirm)|no (information|info|data)|n\/a)\b/i;

/** The first line in the text that answers this topic (and doesn't just say "unknown"). */
function lineAbout(text: string, topic: RegExp): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s>*#-]+/, "").trim();
    if (line && topic.test(line) && !UNKNOWN.test(line)) return line.length > 220 ? `${line.slice(0, 217)}…` : line;
  }
  return null;
}

const TOPICS: Partial<Record<ProfileItemKey, RegExp>> = {
  services: /\bservices?\b|\bspeciali[sz]e|\bservice area\b/i,
  hours: /\bhours\b|\bopen (mon|tue|wed|thu|fri|sat|sun|daily|7 days|24)|\b(mon|monday)\s*(-|–|to)\s*(fri|friday|sat|saturday|sun)/i,
  team: /\bemployees?\b|\bteam (size|of)\b|\bstaff\b|\byears in business\b|\bfounded\b|\bsince (19|20)\d\d\b|\bestablished\b/i,
  rating: /\bgoogle\b.*(\d(\.\d)?\s*(★|stars?)|rating)|\brating\b|\d(\.\d)?\s*★/i,
  social: /\b(facebook|instagram|linkedin|tiktok|youtube|x\.com|twitter)\b/i,
  reach: /\b(online booking|book online|booking (link|page|system)|after[- ]hours|answering service|chat (widget|bot)|live chat|voicemail)\b/i,
};

/** What's known for each profile item (a short line), or null when it's missing. */
export function knownProfile(input: KnownInput): Record<ProfileItemKey, string | null> {
  const a = input.account;
  const text = [...input.reports, a.notes, ...input.summaries.flatMap((s) => s.keyFacts ?? [])].join("\n");
  const people = [
    ...input.contacts.filter((c) => c.firstName || c.lastName).map((c) => [[c.firstName, c.lastName].filter(Boolean).join(" "), c.title].filter(Boolean).join(", ")),
    ...input.summaries.flatMap((s) => s.decisionMakers ?? []).map((d) => [d.name, d.title].filter(Boolean).join(", ")),
  ];
  const services = lineAbout(text, TOPICS.services!);
  return {
    website: a.website,
    phone: a.phone,
    address: a.city && a.state ? lineAbout(text, /\b(address|located at|\d+ [A-Za-z]+ (st|street|ave|avenue|rd|road|dr|drive|way|blvd|hwy))\b/i) ?? `${a.city}, ${a.state}` : null,
    services: services ? (a.industry ? `${a.industry}. ${services}` : services) : null,
    hours: lineAbout(text, TOPICS.hours!),
    team: a.employees != null ? `About ${a.employees} people` : lineAbout(text, TOPICS.team!),
    people: people.length ? [...new Set(people)].slice(0, 4).join("; ") : null,
    rating: lineAbout(text, TOPICS.rating!),
    social: lineAbout(text, TOPICS.social!),
    reach: lineAbout(text, TOPICS.reach!),
  };
}

export function missingItems(known: Record<ProfileItemKey, string | null>): ProfileItemKey[] {
  return PROFILE_ITEMS.filter((i) => !known[i.key]).map((i) => i.key);
}

function onFile(known: Record<ProfileItemKey, string | null>): string {
  return PROFILE_ITEMS.filter((i) => known[i.key]).map((i) => `- ${i.label}: ${known[i.key]}`).join("\n");
}

/**
 * The company profile prompt narrowed to what's missing. Null when nothing is missing, so the run
 * can be skipped (no API cost). `basePrompt` is the saved prompt as rendered for this account.
 */
export function gapsPrompt(basePrompt: string, known: Record<ProfileItemKey, string | null>): { prompt: string; missing: ProfileItemKey[] } | null {
  const missing = missingItems(known);
  if (!missing.length) return null;
  const have = onFile(known);
  const prompt = `${basePrompt}

---
We already have some of this on file. Don't search for these again; use them only to confirm you have the right business:
${have || "- (only the name)"}

Search ONLY for what's still missing:
${PROFILE_ITEMS.filter((i) => missing.includes(i.key)).map((i) => `- ${i.label}`).join("\n")}

Report the match confirmation and the missing items only, each fact followed by its source link. Write "unknown" for any you can't verify.`;
  return { prompt, missing };
}

/** Re-check what's on file, as of today: what's unchanged, what changed, and anything important that's new. */
export function updatePrompt(name: string, known: Record<ProfileItemKey, string | null>, today: string): string {
  return `Check whether what we have on file for ${name} is still current (today is ${today}).

On file:
${onFile(known) || "- (only the name)"}

1. First confirm you have the right business (name plus the website, phone or location). Start with "Match: confirmed", or "Match: not confirmed" with the reason, and stop if you can't confirm it.
2. For each item on file, say "unchanged", "changed: <the new value>", or "couldn't check", with the source link you used.
3. Then fill in anything from this list we don't have yet, if a source states it: ${PROFILE_ITEMS.filter((i) => !known[i.key]).map((i) => i.label.toLowerCase()).join("; ") || "nothing"}.
4. Note anything important that's new: moved, closed, new owner or manager, new services, new hours, a new booking system or answering service.
Facts only, each with its source link. Never guess contact details, and never mix in a business with a similar name.`;
}

/** Search budget for a gaps run: fewer searches when little is missing. */
export function gapsBudget(missing: number): { maxSearches: number; maxFetches: number } {
  return { maxSearches: Math.min(5, 1 + Math.ceil(missing / 2)), maxFetches: Math.min(3, Math.max(1, Math.ceil(missing / 3))) };
}

type MergeableSummary = { keyFacts: string[]; painSignals: string[]; suggestedOpener: string; kbQuestions: string[] };
const uniq = (xs: string[], cap: number) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, cap);
};

/**
 * Carry what's known forward into a newer research summary (the call brief reads the newest one):
 * facts and missed-call signals are combined. A gaps run keeps the earlier opener and questions;
 * an update run prefers its own.
 */
export function carryForward<T extends MergeableSummary>(next: T, prior: Partial<MergeableSummary> | null, mode: "gaps" | "update"): T {
  if (!prior) return next;
  const gaps = mode === "gaps";
  return {
    ...next,
    keyFacts: uniq(gaps ? [...(prior.keyFacts ?? []), ...next.keyFacts] : [...next.keyFacts, ...(prior.keyFacts ?? [])], 8),
    painSignals: uniq([...next.painSignals, ...(prior.painSignals ?? [])], 6),
    suggestedOpener: gaps ? prior.suggestedOpener || next.suggestedOpener : next.suggestedOpener || prior.suggestedOpener || "",
    kbQuestions: gaps && prior.kbQuestions?.length ? prior.kbQuestions : next.kbQuestions.length ? next.kbQuestions : prior.kbQuestions ?? [],
  };
}

/** "Phone: 604-555-0100 → 778-555-0199" lines for the fields an update changed. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, label] of Object.entries(labels)) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (String(a ?? "") !== String(b ?? "")) out.push(`${label}: ${a ?? "—"} → ${b ?? "—"}`);
  }
  return out;
}
