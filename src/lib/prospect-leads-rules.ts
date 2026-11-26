// Pure rules for researched leads (no DB): validate what the research skill sends, score how
// likely a business is to buy, and decide what promoting a lead writes to the account.
import { normalizeDomain, websiteUrl } from "./utils";
import { accountKeyName, phoneKey } from "./team-rules";
import { parsePack, type PackProspect } from "./prospect-pack-rules";

/** Paid lead sources the skill checks. Each one means the business already pays for calls. */
export const PAID_CHANNELS = {
  lsa: { label: "Google Local Services Ads", short: "LSA", points: 30, tag: "paid-lsa" },
  googleVerified: { label: "Google Verified badge", short: "Verified", points: 10, tag: "google-verified" },
  googleSearchAds: { label: "Google search ads", short: "Google Ads", points: 20, tag: "paid-google-ads" },
  homestarsFeatured: { label: "HomeStars featured ad", short: "HS featured", points: 20, tag: "paid-homestars" },
  homestarsVerified: { label: "HomeStars Verified (paid member)", short: "HS paid", points: 15, tag: "paid-homestars" },
  metaAds: { label: "Facebook / Instagram ads", short: "Meta", points: 10, tag: "paid-meta" },
  yelpAds: { label: "Yelp sponsored", short: "Yelp", points: 10, tag: "paid-yelp" },
  callTracking: { label: "Call-tracking number", short: "Tracking #", points: 5, tag: "call-tracking" },
} as const;
export type PaidChannel = keyof typeof PAID_CHANNELS;
export const CHANNEL_KEYS = Object.keys(PAID_CHANNELS) as PaidChannel[];
export type Channels = Partial<Record<PaidChannel, boolean>>;

export const LEAD_STATUSES = ["NEW", "PROSPECT", "DIALER", "DISMISSED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  PROSPECT: "In prospects",
  DIALER: "On call list",
  DISMISSED: "Dismissed",
};

/** Tag that puts an account on the dialer's "Call list" filter. */
export const CALL_LIST_TAG = "call-list";
export const SIGNAL_POINTS = 5;
export const SIGNAL_CAP = 20;
export const MAX_LEADS_PER_REQUEST = 200;

export type Evidence = { channel: string; url: string | null; note: string };

export type CleanLead = {
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  channels: Channels;
  evidence: Evidence[];
  signals: string[];
  notes: string;
  googleRating: number | null;
  reviewCount: number | null;
  score: number;
  /**
   * The fact-only company profile the skill researched, in the prospect-pack prospect shape
   * (address, hours, employees, contacts, research { match, report, keyFacts, … }). Applied as the
   * account's Company profile when the lead is promoted. Null when none was sent or it was unusable.
   */
  profile: Record<string, unknown> | null;
  /** Why a profile that was sent couldn't be used (reported back to the skill, not stored). */
  profileProblem?: string;
};

export type IntakeResult = { leads: CleanLead[]; search: { industry: string; region: string }; errors: { index: number; message: string }[] };

function text(v: unknown, max = 300): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

function httpUrl(v: unknown): string | null {
  const s = text(v, 1000);
  return s && /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === "string" && /^(true|yes|y|1)$/i.test(v.trim()));
}

/** Channels from an object ({ lsa: true }) or a list (["lsa", "metaAds"]); unknown keys are dropped. */
export function cleanChannels(raw: unknown): Channels {
  const out: Channels = {};
  if (Array.isArray(raw)) {
    for (const k of raw) if (typeof k === "string" && (CHANNEL_KEYS as string[]).includes(k)) out[k as PaidChannel] = true;
  } else if (raw && typeof raw === "object") {
    for (const k of CHANNEL_KEYS) if (truthy((raw as Record<string, unknown>)[k])) out[k] = true;
  }
  // A Google Verified badge only shows on Local Services Ads.
  if (out.googleVerified) out.lsa = true;
  return out;
}

/**
 * 0-100. Paid channels count most (they already pay per call, so a missed call wastes their
 * money); each buying signal adds a little; a smaller review count suggests an owner-operator.
 */
export function scoreLead(channels: Channels, signals: string[], reviewCount: number | null): number {
  let score = 0;
  for (const k of CHANNEL_KEYS) if (channels[k]) score += PAID_CHANNELS[k].points;
  // HomeStars featured implies paid membership: count the HomeStars points once.
  if (channels.homestarsFeatured && channels.homestarsVerified) score -= PAID_CHANNELS.homestarsVerified.points;
  score += Math.min(SIGNAL_CAP, signals.length * SIGNAL_POINTS);
  if (reviewCount !== null && reviewCount > 0 && reviewCount < 150) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function paidChannelCount(channels: Channels): number {
  return CHANNEL_KEYS.filter((k) => k !== "googleVerified" && k !== "callTracking" && channels[k]).length;
}

/** Validate one lead from the skill (or a paste). Returns a message when it can't be used. */
/**
 * The lead's company profile, checked with the same parser (and AI-instruction screen) as the
 * prospecting skill's packs. Lead fields fill in what the profile leaves out. Returns the parsed
 * prospect (summary and report set) or a reason it can't be used.
 */
export function profileProspect(
  profile: Record<string, unknown>,
  lead: Pick<CleanLead, "name" | "website" | "phone" | "industry" | "city" | "region" | "googleRating" | "reviewCount" | "score">,
  criteria: string | null = null,
): PackProspect | string {
  const merged = {
    ...profile,
    name: lead.name,
    website: profile.website ?? lead.website,
    phone: profile.phone ?? lead.phone,
    industry: profile.industry ?? lead.industry,
    city: profile.city ?? lead.city,
    state: profile.state ?? lead.region,
    googleRating: profile.googleRating ?? lead.googleRating,
    reviewCount: profile.reviewCount ?? lead.reviewCount,
    // The lead's paid-channel score is the account's fit score; research mustn't reset it.
    fitScore: lead.score,
  };
  const pack = parsePack({ criteria, prospects: [merged] });
  const p = pack.prospects[0];
  if (!p) return pack.problems[0] ?? "the profile couldn't be read";
  if (!p.report || !p.summary) return pack.problems.find((x) => x.startsWith(lead.name)) ?? "the profile has no research write-up";
  return p;
}

/** Keep only the profile fields the pack format knows, so stored JSON stays small and predictable. */
const PROFILE_KEYS = ["website", "phone", "industry", "address", "city", "state", "employees", "hours", "googleRating", "reviewCount", "sourceUrl", "contacts", "research"] as const;

export function cleanLead(raw: unknown): CleanLead | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const r = raw as Record<string, unknown>;
  const name = text(r.name, 200);
  if (!name) return "missing name";
  const website = websiteUrl(text(r.website, 500));
  const phone = text(r.phone, 40);
  if (!website && !phoneKey(phone)) return `${name}: needs a website or a 10-digit phone number`;
  const channels = cleanChannels(r.channels);
  const evidence: Evidence[] = (Array.isArray(r.evidence) ? r.evidence : [])
    .slice(0, 20)
    .map((e): Evidence | null => {
      if (typeof e === "string") return { channel: "note", url: httpUrl(e), note: httpUrl(e) ? "" : text(e, 500) ?? "" };
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      return { channel: text(o.channel, 40) ?? "note", url: httpUrl(o.url), note: text(o.note, 500) ?? "" };
    })
    .filter((e): e is Evidence => Boolean(e && (e.url || e.note)));
  const signals = (Array.isArray(r.signals) ? r.signals : []).map((s) => text(s, 200)).filter((s): s is string => Boolean(s)).slice(0, 10);
  const reviewCount = num(r.reviewCount);
  const rating = num(r.googleRating);
  const cleanReviews = reviewCount !== null && reviewCount >= 0 ? Math.round(reviewCount) : null;
  const lead: CleanLead = {
    name,
    domain: normalizeDomain(website),
    website,
    phone,
    industry: text(r.industry, 100),
    city: text(r.city, 100),
    region: text(r.region ?? r.province ?? r.state, 60),
    channels,
    evidence,
    signals,
    notes: text(r.notes, 2000) ?? "",
    googleRating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount: cleanReviews,
    score: scoreLead(channels, signals, cleanReviews),
    profile: null,
  };
  if (r.profile && typeof r.profile === "object" && !Array.isArray(r.profile)) {
    const src = r.profile as Record<string, unknown>;
    const profile = Object.fromEntries(PROFILE_KEYS.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
    const checked = profileProspect(profile, lead);
    if (typeof checked === "string") lead.profileProblem = checked;
    else lead.profile = profile;
  }
  return lead;
}

/**
 * The intake payload: `{ search: { industry, region }, leads: [...] }` or a bare array of leads.
 * Leads that fail validation are reported, not fatal. Duplicates inside one payload are merged.
 */
export function parseIntake(body: unknown): IntakeResult | string {
  const obj = Array.isArray(body) ? { leads: body } : body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!obj || !Array.isArray(obj.leads)) return "Expected { leads: [...] } or an array of leads";
  if (obj.leads.length > MAX_LEADS_PER_REQUEST) return `Send at most ${MAX_LEADS_PER_REQUEST} leads per request`;
  const s = (obj.search && typeof obj.search === "object" ? obj.search : {}) as Record<string, unknown>;
  const search = { industry: text(s.industry, 100) ?? "", region: text(s.region, 100) ?? "" };
  const errors: { index: number; message: string }[] = [];
  const leads: CleanLead[] = [];
  obj.leads.forEach((raw, index) => {
    const lead = cleanLead(raw);
    if (typeof lead === "string") return void errors.push({ index, message: lead });
    if (lead.profileProblem) errors.push({ index, message: `${lead.name}: saved without its company profile (${lead.profileProblem})` });
    const twin = leads.find((l) => sameBusiness(l, lead));
    if (twin) Object.assign(twin, mergeLead(twin, lead));
    else leads.push(lead);
  });
  return { leads, search, errors };
}

type Matchable = { domain: string | null; phone: string | null; name: string; city: string | null };

/** Same business: same website, same phone, or the same name in the same city. */
export function sameBusiness(a: Matchable, b: Matchable): boolean {
  if (a.domain && a.domain === b.domain) return true;
  const pa = phoneKey(a.phone);
  if (pa && pa === phoneKey(b.phone)) return true;
  const na = accountKeyName(a.name);
  return na.length >= 4 && na === accountKeyName(b.name) && (a.city ?? "").toLowerCase() === (b.city ?? "").toLowerCase();
}

type Mergeable = Omit<CleanLead, "score">;

/** Found again: keep what we had, fill blanks, add new channels, evidence and signals, re-score. */
export function mergeLead(prev: Mergeable, next: Mergeable): CleanLead {
  const channels: Channels = { ...prev.channels };
  for (const k of CHANNEL_KEYS) if (next.channels[k]) channels[k] = true;
  const evidence = [...prev.evidence];
  for (const e of next.evidence) if (!evidence.some((x) => x.channel === e.channel && x.url === e.url && x.note === e.note)) evidence.push(e);
  const signals = Array.from(new Set([...prev.signals, ...next.signals]));
  const reviewCount = next.reviewCount ?? prev.reviewCount;
  return {
    name: prev.name,
    domain: prev.domain ?? next.domain,
    website: prev.website ?? next.website,
    phone: prev.phone ?? next.phone,
    industry: prev.industry ?? next.industry,
    city: prev.city ?? next.city,
    region: prev.region ?? next.region,
    channels,
    evidence: evidence.slice(0, 30),
    signals: signals.slice(0, 15),
    notes: next.notes && !prev.notes.includes(next.notes) ? `${prev.notes}\n${next.notes}`.trim() : prev.notes,
    googleRating: next.googleRating ?? prev.googleRating,
    reviewCount,
    score: scoreLead(channels, signals, reviewCount),
    // A newer profile replaces an older one; otherwise keep what we had.
    profile: next.profile ?? prev.profile,
  };
}

/** Tags an account gets when a lead is promoted. */
export function promotionTags(channels: Channels, toDialer: boolean): string[] {
  const tags = new Set<string>(["researched-lead"]);
  for (const k of CHANNEL_KEYS) if (channels[k]) tags.add(PAID_CHANNELS[k].tag);
  if (toDialer) tags.add(CALL_LIST_TAG);
  return [...tags];
}

/** Account notes: what they pay for, with proof, so the call opener is ready. */
export function promotionNotes(lead: Pick<CleanLead, "channels" | "evidence" | "signals" | "notes" | "googleRating" | "reviewCount">, search: { industry: string; region: string }): string {
  const paid = CHANNEL_KEYS.filter((k) => lead.channels[k]).map((k) => PAID_CHANNELS[k].label);
  const lines = [`Researched lead${search.industry || search.region ? ` (${[search.industry, search.region].filter(Boolean).join(", ")})` : ""}.`];
  if (paid.length) lines.push(`Pays for leads: ${paid.join(", ")}.`);
  if (lead.googleRating !== null) lead.reviewCount !== null ? lines.push(`Google: ${lead.googleRating}★ from ${lead.reviewCount} reviews.`) : lines.push(`Google: ${lead.googleRating}★.`);
  if (lead.signals.length) lines.push(`Signals: ${lead.signals.join("; ")}.`);
  for (const e of lead.evidence.slice(0, 8)) lines.push(`- ${e.channel}: ${[e.note, e.url].filter(Boolean).join(" ")}`);
  if (lead.notes) lines.push(lead.notes);
  return lines.join("\n");
}

/** What the lead research itself found, in the shape the call brief and research panel read. */
export type LeadFacts = { keyFacts: string[]; painSignals: string[]; opener: string; report: string };

/**
 * The lead's own findings (paid channels with proof, Google rating, buying signals) as research:
 * key facts, missed-call signals and an opener for the call brief, plus a short write-up with the
 * proof links. Saved on the account when the lead is promoted, so nothing the lead found is lost.
 */
export function leadFacts(lead: Pick<CleanLead, "channels" | "evidence" | "signals" | "googleRating" | "reviewCount" | "notes">, search: { industry: string; region: string }): LeadFacts {
  const paid = CHANNEL_KEYS.filter((k) => lead.channels[k] && k !== "googleVerified" && k !== "callTracking").map((k) => PAID_CHANNELS[k].label);
  const keyFacts: string[] = [];
  if (paid.length) keyFacts.push(`Pays for leads: ${paid.join(", ")}`);
  if (lead.channels.googleVerified) keyFacts.push("Google Verified (Local Services)");
  if (lead.channels.callTracking) keyFacts.push("Uses a call-tracking number");
  if (lead.googleRating !== null) keyFacts.push(`Google: ${lead.googleRating}★${lead.reviewCount !== null ? ` from ${lead.reviewCount} reviews` : ""}`);
  const painSignals = [
    ...(paid.length ? [`Pays per lead on ${paid[0]}${paid.length > 1 ? ` and ${paid.length - 1} more` : ""}, so every missed call wastes money already spent`] : []),
    ...lead.signals,
  ];
  const opener = paid.length
    ? `I saw you're on ${paid[0]}. When one of those paid calls comes in while you're on a job, who picks it up?`
    : lead.signals.length
      ? `I was reading your reviews and noticed ${lead.signals[0].replace(/\.$/, "").toLowerCase()}. Can I ask how you handle calls when you're busy?`
      : "";
  const lines = [`Match: confirmed (researched lead${search.industry || search.region ? `, ${[search.industry, search.region].filter(Boolean).join(", ")}` : ""})`];
  if (paid.length) lines.push(`- Pays for leads: ${paid.join(", ")}`);
  for (const e of lead.evidence.slice(0, 8)) lines.push(`- ${e.channel}: ${[e.note, e.url ? `([source](${e.url}))` : ""].filter(Boolean).join(" ")}`);
  if (lead.googleRating !== null) lines.push(`- Google: ${lead.googleRating}★${lead.reviewCount !== null ? ` from ${lead.reviewCount} reviews` : ""}`);
  for (const s of lead.signals) lines.push(`- Signal: ${s}`);
  if (lead.notes) lines.push(`- Notes: ${lead.notes}`);
  return { keyFacts, painSignals, opener, report: lines.join("\n") };
}

/** Lead facts first, then what was already known (deduplicated), for the newest research summary. */
export function withLeadFacts<T extends { keyFacts: string[]; painSignals: string[]; suggestedOpener: string }>(summary: T, facts: LeadFacts): T {
  const uniq = (xs: string[], cap: number) => [...new Map(xs.filter((x) => x.trim()).map((x) => [x.trim().toLowerCase(), x.trim()])).values()].slice(0, cap);
  return {
    ...summary,
    keyFacts: uniq([...facts.keyFacts, ...summary.keyFacts], 8),
    painSignals: uniq([...facts.painSignals, ...summary.painSignals], 6),
    suggestedOpener: summary.suggestedOpener || facts.opener,
  };
}
