// Demo agent research (pure; unit tested): what the deep research collects about a prospect, and
// how it becomes their demo agent's settings and knowledge.
//
// Rules:
// - Prices are quoted only when the business publishes them itself ("starting at" wording);
//   prices seen elsewhere go in the report, never in the agent.
// - Gaps are filled with typical defaults for the trade so the demo sounds complete. Each one is
//   tagged "assumed", titled "(assumed)" in the CRM, and listed as a question for the owner.
// - Everything the research adds is tagged "demo-research", so a re-run replaces it cleanly.

import { z } from "zod";
import { looksLikeInstructions } from "./safety-rules";

export const DEMO_RESEARCH_TAG = "demo-research";
export const ASSUMED_TAG = "assumed";

const nullableText = z.string().nullable();

export const DemoProfileSchema = z.object({
  match: z.enum(["confirmed", "not_confirmed"]).describe("Whether the report confirms it found the right business (name plus website, phone or address matching)"),
  business: z.object({
    name: z.string(),
    description: z.string().describe("Two or three sentences a receptionist could say: what they do and for whom"),
    trade: nullableText.describe("Their trade or industry in a few words, e.g. 'residential plumbing'"),
    phone: nullableText,
    email: nullableText.describe("Only an address published by the business itself"),
    address: nullableText,
    yearsInBusiness: nullableText,
    licensing: nullableText.describe("Licences, certifications, insurance or bonding they state"),
  }),
  serviceArea: nullableText.describe("Towns, neighbourhoods or radius they serve"),
  services: z.array(z.object({
    name: z.string(),
    description: z.string(),
    price: nullableText.describe("The price as written, e.g. 'from $89'; null if none"),
    priceSource: z.enum(["own_website", "elsewhere", "none"]).describe("own_website only when the business itself publishes this price (its site or its Google profile)"),
  })),
  hours: nullableText.describe("Opening hours by day, as one short block of text"),
  holidayHours: nullableText.describe("Holiday or seasonal closures they publish"),
  afterHours: nullableText.describe("Emergency or after-hours service and how it works"),
  booking: nullableText.describe("How customers book: online link, phone, walk-in, quotes, site visits, lead times"),
  bookingUrl: nullableText,
  policies: z.array(z.object({ topic: z.string(), detail: z.string() })).describe("Payment methods, deposits, financing, warranties, guarantees, cancellations, returns"),
  staff: z.array(z.object({ name: z.string(), role: z.string() })).describe("People named publicly (owner, manager, office) a caller might ask for"),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).describe("Questions callers ask (from their FAQ page and reviews) with the business's own answers"),
  differentiators: z.array(z.string()).describe("Why customers choose them, as they say it"),
  tone: nullableText.describe("How they talk to customers: e.g. 'friendly, family-run, plain-spoken'"),
  reviews: z.object({
    rating: nullableText.describe("e.g. '4.8 from 212 Google reviews'"),
    praise: z.array(z.string()),
    complaints: z.array(z.string()),
    callerQuestions: z.array(z.string()).describe("What reviewers say they called or asked about"),
  }),
  competitors: z.array(z.object({ name: z.string(), notes: z.string().describe("Services, prices or hours worth knowing, and how this business compares") })),
  assumed: z.array(z.object({
    category: z.enum(["HOURS", "LOCATION", "SERVICE", "POLICY", "FAQ", "OTHER"]),
    title: z.string(),
    content: z.string().describe("A typical answer for this trade, worded so it doesn't promise anything specific (no prices)"),
  })).describe("Only for things a caller would likely ask that the research could not find: hours, service area, booking, payment, warranty, emergencies"),
  ownerQuestions: z.array(z.string()).describe("Up to 8 questions to confirm with the owner: every assumption, plus the biggest gaps"),
});
export type DemoProfile = z.infer<typeof DemoProfileSchema>;

export type KbEntry = { category: string; title: string; content: string; tags: string; isActive: boolean };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+\n/g, "\n").trim();
const has = (s: string | null | undefined) => clean(s).length > 0 && !/^unknown\.?$/i.test(clean(s));

/** The knowledge entries a profile becomes. Website text that reads like instructions is dropped. */
export function profileToKnowledge(p: DemoProfile): KbEntry[] {
  const out: KbEntry[] = [];
  const add = (category: string, title: string, content: string, assumed = false) => {
    if (!has(content) || looksLikeInstructions(`${title}\n${content}`)) return;
    out.push({ category, title: assumed ? `${title} (assumed)` : title, content: clean(content), tags: assumed ? `${DEMO_RESEARCH_TAG},${ASSUMED_TAG}` : DEMO_RESEARCH_TAG, isActive: true });
  };
  const b = p.business;
  add("OTHER", `About ${b.name}`, [b.description, b.yearsInBusiness ? `In business: ${b.yearsInBusiness}.` : "", b.licensing ? `Licensing and insurance: ${b.licensing}.` : ""].filter(Boolean).join("\n"));
  add("LOCATION", "Address and service area", [b.address ? `Address: ${b.address}.` : "", p.serviceArea ? `Service area: ${p.serviceArea}.` : ""].filter(Boolean).join("\n"));
  add("HOURS", "Business hours", p.hours ?? "");
  add("HOURS", "Holiday hours", p.holidayHours ?? "");
  add("POLICY", "After hours and emergencies", p.afterHours ?? "");
  add("FAQ", "How do I book?", [p.booking, p.bookingUrl ? `Online booking: ${p.bookingUrl}` : ""].filter(Boolean).join("\n"));
  if (has(b.phone) || has(b.email)) add("OTHER", "Contact details", [b.phone ? `Phone: ${b.phone}` : "", b.email ? `Email: ${b.email}` : ""].filter(Boolean).join("\n"));

  for (const s of p.services) {
    // Only the business's own published prices are quoted.
    const price = s.price && s.priceSource === "own_website" ? `\nPublished price: ${s.price}. Exact cost depends on the job; we confirm before starting.` : "";
    add("SERVICE", s.name, `${s.description}${price}`);
  }
  const published = p.services.filter((s) => s.price && s.priceSource === "own_website");
  add("PRICING", "Pricing", published.length
    ? `Published prices: ${published.map((s) => `${s.name} ${s.price}`).join("; ")}. Anything else is quoted after we know the details.`
    : "Prices depend on the job, so we give a quote once we know the details. I can take your information and have someone get back to you with a quote.");
  for (const x of p.policies) add("POLICY", x.topic, x.detail);
  if (p.staff.length) add("STAFF", "Team", p.staff.map((s) => `${s.name}: ${s.role}`).join("\n"));
  for (const f of p.faqs) add("FAQ", f.question, f.answer);
  if (p.differentiators.length) add("OTHER", "Why customers choose us", p.differentiators.map((d) => `- ${d}`).join("\n"));

  // Typical defaults, only where the research found nothing on that subject.
  const titles = new Set(out.map((k) => k.category));
  for (const a of p.assumed) {
    if ((a.category === "HOURS" || a.category === "LOCATION") && titles.has(a.category)) continue;
    add(a.category, a.title, a.content, true);
  }
  return dedupe(out);
}

function dedupe(items: KbEntry[]): KbEntry[] {
  const seen = new Set<string>();
  return items.filter((k) => {
    const key = `${k.category}|${k.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Agent settings from the profile (only what research can fairly set). */
export function profileToSettings(p: DemoProfile, o: { agentName: string }): { greeting: string; persona?: string; businessHours?: string; bookingUrl?: string } {
  const out: { greeting: string; persona?: string; businessHours?: string; bookingUrl?: string } = {
    greeting: `Thanks for calling ${p.business.name}, this is ${o.agentName}. How can I help you today?`,
  };
  if (has(p.tone) && !looksLikeInstructions(p.tone!)) out.persona = `Warm, concise and professional; matches the business's own tone: ${clean(p.tone)}.`;
  if (has(p.hours)) out.businessHours = clean(p.hours);
  if (has(p.bookingUrl) && /^https:\/\//i.test(clean(p.bookingUrl))) out.bookingUrl = clean(p.bookingUrl);
  return out;
}

/** The report shown on the research page and saved with the run. */
export function profileReport(p: DemoProfile): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- none found");
  const val = (s: string | null | undefined) => (has(s) ? clean(s) : "_not found_");
  const b = p.business;
  return [
    p.match === "not_confirmed" ? "> **Check this is the right business:** the research couldn't confirm the match.\n" : "",
    `## ${b.name}`,
    val(b.description),
    `**Trade:** ${val(b.trade)} · **Phone:** ${val(b.phone)} · **Email:** ${val(b.email)}`,
    `**Address:** ${val(b.address)} · **Service area:** ${val(p.serviceArea)}`,
    `**In business:** ${val(b.yearsInBusiness)} · **Licensing:** ${val(b.licensing)}`,
    `## Hours\n${val(p.hours)}\n\n**Holidays:** ${val(p.holidayHours)}\n\n**After hours / emergencies:** ${val(p.afterHours)}`,
    `## Booking\n${val(p.booking)}${p.bookingUrl ? `\n\nOnline: ${p.bookingUrl}` : ""}`,
    `## Services and prices\n${p.services.length ? p.services.map((s) => `- **${s.name}**: ${s.description}${s.price ? ` — ${s.price} (${s.priceSource === "own_website" ? "published by them: the agent quotes it" : "seen elsewhere: not quoted"})` : ""}`).join("\n") : "- none found"}`,
    `## Policies\n${list(p.policies.map((x) => `**${x.topic}:** ${x.detail}`))}`,
    `## Team\n${list(p.staff.map((s) => `${s.name}, ${s.role}`))}`,
    `## Caller FAQs\n${list(p.faqs.map((f) => `**${f.question}** ${f.answer}`))}`,
    `## Reviews\n**Rating:** ${val(p.reviews.rating)}\n\n**Praise**\n${list(p.reviews.praise)}\n\n**Complaints**\n${list(p.reviews.complaints)}\n\n**What callers ask about**\n${list(p.reviews.callerQuestions)}`,
    `## Why customers choose them\n${list(p.differentiators)}\n\n**Tone:** ${val(p.tone)}`,
    `## Local competitors\n${list(p.competitors.map((c) => `**${c.name}:** ${c.notes}`))}`,
    `## Assumed for the demo (confirm with the owner)\n${list(p.assumed.map((a) => `**${a.title}:** ${a.content}`))}`,
    `## Questions for the owner\n${list(p.ownerQuestions)}`,
  ].filter(Boolean).join("\n\n");
}
