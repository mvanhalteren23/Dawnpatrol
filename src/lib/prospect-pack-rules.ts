// The "prospect pack": what the Claude prospecting skill (claude-skill/head-above-prospecting)
// sends into the CRM. Claude researches in the person's own Claude app, so no API fees; this file
// turns its JSON into the same records the in-app prospecting + research produce (pure; unit tested).

import { z } from "zod";
import type { ResearchSummary } from "./ai";
import type { ImportRow } from "./csv";
import { cleanQuestions } from "./discovery-rules";
import { looksLikeInstructions } from "./safety-rules";
import { normalizeDomain, websiteUrl } from "./utils";

export const PACK_FORMAT = "headabove.prospects.v1";
export const MAX_PACK_PROSPECTS = 50;
const MAX_REPORT_CHARS = 40_000;

const text = (max: number) =>
  z.preprocess((v) => (v == null ? null : typeof v === "number" ? String(v) : v), z.string().nullable().optional())
    .transform((v) => {
      const t = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
      return t && !/^(unknown|n\/a|none|null|-|—)$/i.test(t) ? t : null;
    });
const longText = (max: number) =>
  z.preprocess((v) => (v == null ? "" : v), z.string()).transform((v) => v.trim().slice(0, max));
const num = z.preprocess((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());
const list = (max: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []), z.array(z.unknown()))
    .transform((a) => a.map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 400) : "")).filter(Boolean).slice(0, max));

const ContactSchema = z.object({
  name: text(120),
  title: text(120),
  email: text(200),
  phone: text(40),
  linkedin: text(300),
});

const ResearchSchema = z.object({
  match: z.preprocess((v) => (v === "not_confirmed" || v === false ? "not_confirmed" : "confirmed"), z.enum(["confirmed", "not_confirmed"])),
  report: longText(MAX_REPORT_CHARS),
  keyFacts: list(8),
  painSignals: list(8),
  estMissedCallsPerWeek: num,
  avgJobValue: num,
  suggestedOpener: text(400),
  discoveryQuestions: z.unknown().optional(),
});

const ProspectSchema = z.object({
  name: text(200),
  website: text(300),
  phone: text(40),
  industry: text(120),
  address: text(300),
  city: text(120),
  state: text(60),
  employees: num,
  fitScore: num,
  whyFit: text(600),
  sourceUrl: text(500),
  googleRating: num,
  reviewCount: num,
  hours: text(300),
  contacts: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())),
  research: z.unknown().optional(),
});

const PackSchema = z.object({
  format: z.string().optional(),
  criteria: text(500),
  prospects: z.array(z.unknown()),
});

export type PackContact = z.infer<typeof ContactSchema>;

export type PackProspect = {
  index: number;
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  employees: number | null;
  fitScore: number | null;
  whyFit: string | null;
  notes: string;
  contacts: { firstName: string | null; lastName: string | null; title: string | null; email: string | null; phone: string | null; linkedin: string | null }[];
  /** Null when the skill sent no research write-up for this business. */
  report: string | null;
  summary: ResearchSummary | null;
};

export type ParsedPack = { criteria: string | null; prospects: PackProspect[]; problems: string[] };

const int = (n: number | null, lo: number, hi: number) => (n == null ? null : Math.max(lo, Math.min(hi, Math.round(n))));
const validEmail = (e: string | null) => (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.toLowerCase() : null);
const validUrl = (u: string | null) => (u && /^https?:\/\/\S+$/i.test(u) ? u : null);

function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { firstName: first || null, lastName: rest.join(" ") || null };
}

/** The pack's JSON may arrive wrapped in a ```json fence or with chat text around it. */
export function extractJson(raw: string): unknown {
  const s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON found. Paste the whole prospect pack Claude made (it starts with { and ends with }).");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("The prospect pack isn't valid JSON. Ask Claude to \"output the prospect pack again as one JSON block\" and paste that.");
  }
}

export function parsePack(input: unknown): ParsedPack {
  const pack = PackSchema.safeParse(input);
  if (!pack.success) throw new Error("That isn't a prospect pack: it needs a \"prospects\" list.");
  const problems: string[] = [];
  if (pack.data.prospects.length > MAX_PACK_PROSPECTS) problems.push(`Only the first ${MAX_PACK_PROSPECTS} prospects were read (the pack had ${pack.data.prospects.length}).`);
  const prospects: PackProspect[] = [];
  pack.data.prospects.slice(0, MAX_PACK_PROSPECTS).forEach((raw, i) => {
    const p = ProspectSchema.safeParse(raw ?? {});
    if (!p.success || !p.data.name) {
      problems.push(`Prospect ${i + 1} has no business name, so it was skipped.`);
      return;
    }
    const d = p.data;
    const domain = normalizeDomain(d.website);
    const contacts = d.contacts
      .map((c) => ContactSchema.safeParse(c ?? {}))
      .filter((c) => c.success && (c.data.name || c.data.email))
      .map((c) => {
        const x = (c as { data: PackContact }).data;
        return { ...splitName(x.name ?? ""), title: x.title, email: validEmail(x.email), phone: x.phone, linkedin: validUrl(x.linkedin) };
      })
      .slice(0, 5);
    const r = d.research == null ? null : ResearchSchema.safeParse(d.research);
    const research = r?.success ? r.data : null;
    if (r && !r.success) problems.push(`${d.name}: the research section couldn't be read, so only the basics were added.`);
    // Web text can carry instructions aimed at an AI; such a write-up is kept out of the CRM.
    let report = research?.report || null;
    if (report && looksLikeInstructions(report)) {
      problems.push(`${d.name}: the research write-up contained text that reads like instructions to an AI, so it was left out.`);
      report = null;
    }
    const facts = [
      d.address ? `Address: ${d.address}` : null,
      d.hours ? `Hours: ${d.hours}` : null,
      d.googleRating != null ? `Google rating: ${d.googleRating}${d.reviewCount != null ? ` (${Math.round(d.reviewCount)} reviews)` : ""}` : null,
    ].filter((x): x is string => Boolean(x));
    const notes = [
      d.whyFit ? `Why fit: ${d.whyFit}` : null,
      ...facts,
      research?.suggestedOpener ? `Opener: ${research.suggestedOpener}` : null,
      validUrl(d.sourceUrl) ? `Source: ${d.sourceUrl}` : null,
    ].filter(Boolean).join("\n");
    const fitScore = int(d.fitScore, 0, 100);
    const summary: ResearchSummary | null = research && report
      ? {
          match: research.match,
          fitScore: fitScore ?? 50,
          estMissedCallsPerWeek: int(research.estMissedCallsPerWeek, 0, 1000),
          avgJobValueUsd: research.avgJobValue != null && research.avgJobValue > 0 ? Math.min(research.avgJobValue, 1_000_000) : null,
          industry: d.industry,
          website: d.website,
          city: d.city,
          state: d.state,
          phone: d.phone,
          employees: int(d.employees, 1, 100_000),
          keyFacts: [...research.keyFacts, ...facts].slice(0, 8),
          painSignals: research.painSignals,
          decisionMakers: contacts.filter((c) => c.firstName).map((c) => ({ name: [c.firstName, c.lastName].filter(Boolean).join(" "), title: c.title, email: c.email, phone: c.phone, linkedin: c.linkedin })),
          suggestedOpener: research.suggestedOpener ?? "",
          kbQuestions: cleanQuestions(research.discoveryQuestions),
        }
      : null;
    prospects.push({
      index: i,
      name: d.name!,
      domain,
      website: domain ? websiteUrl(d.website) : null,
      phone: d.phone,
      industry: d.industry,
      city: d.city,
      state: d.state,
      employees: int(d.employees, 1, 100_000),
      fitScore,
      whyFit: d.whyFit,
      notes,
      contacts,
      report,
      summary,
    });
  });
  if (!prospects.length && !problems.length) problems.push("The pack has no prospects in it.");
  return { criteria: pack.data.criteria, prospects, problems };
}

/** The CRM import row for a prospect (its first contact; the rest come from the research summary). */
export function packImportRow(p: PackProspect, tags: string[]): ImportRow {
  const c = p.contacts[0];
  return {
    rowNumber: p.index + 1,
    account: {
      name: p.name,
      domain: p.domain,
      website: p.website,
      phone: p.phone,
      industry: p.industry,
      city: p.city,
      state: p.state,
      employees: p.employees,
      stage: null,
      tags,
      notes: p.notes || null,
      avgJobValueCents: p.summary?.avgJobValueUsd != null ? Math.round(p.summary.avgJobValueUsd * 100) : null,
    },
    contact: c ? { firstName: c.firstName, lastName: c.lastName, title: c.title, email: c.email, phone: c.phone, linkedin: c.linkedin } : null,
  };
}

/** The research record's text: the skill's write-up, labelled so it's clear where it came from. */
export function packReportText(p: PackProspect, criteria: string | null): string {
  const head = `Researched in Claude (your own plan) with the Head Above prospecting skill${criteria ? ` — search: ${criteria}` : ""}.`;
  return `${head}\n\n${p.report ?? ""}`.trim();
}
