import "server-only";
import { after } from "next/server";
import { db } from "./db";
import { importRows } from "./importer";
import { applyResearchSummary, archiveRunToDrive, researchNewAccounts } from "./jobs";
import { recordActivity } from "./outreach";
import { SKILL_MODEL } from "./prospect-pack";
import { verifySummary } from "./research-guard";
import { DuplicateIndex } from "./team-rules";
import { joinTags, normalizeDomain, safeJson, splitTags, websiteUrl } from "./utils";
import type { ResearchSummary } from "./ai";
import {
  leadFacts,
  withLeadFacts,
  mergeLead,
  profileProspect,
  promotionNotes,
  promotionTags,
  sameBusiness,
  type Channels,
  type CleanLead,
  type Evidence,
  type IntakeResult,
} from "./prospect-leads-rules";

type LeadRow = Awaited<ReturnType<typeof db.prospectLead.findMany>>[number];

/** The stored row as the rules see it. */
export function leadFromRow(row: LeadRow): CleanLead {
  return {
    name: row.name,
    domain: row.domain,
    website: row.website,
    phone: row.phone,
    industry: row.industry,
    city: row.city,
    region: row.region,
    channels: safeJson<Channels>(row.channels, {}),
    evidence: safeJson<Evidence[]>(row.evidence, []),
    signals: safeJson<string[]>(row.signals, []),
    notes: row.notes,
    googleRating: row.googleRating,
    reviewCount: row.reviewCount,
    score: row.score,
    profile: row.profile ? safeJson<Record<string, unknown> | null>(row.profile, null) : null,
  };
}

function rowData(l: CleanLead) {
  return {
    name: l.name,
    domain: l.domain,
    website: l.website,
    phone: l.phone,
    industry: l.industry,
    city: l.city,
    region: l.region,
    channels: JSON.stringify(l.channels),
    evidence: JSON.stringify(l.evidence),
    signals: JSON.stringify(l.signals),
    notes: l.notes,
    googleRating: l.googleRating,
    reviewCount: l.reviewCount,
    score: l.score,
    profile: l.profile ? JSON.stringify(l.profile) : null,
  };
}

export type IntakeLeadResult = { name: string; status: "created" | "updated"; inCrm: boolean; needsProfile: boolean };
export type IntakeSummary = { created: number; updated: number; alreadyInCrm: number; needsProfile: number; leads: IntakeLeadResult[]; errors: { index: number; message: string }[] };

/**
 * Save researched leads. A business already in the inbox is merged (new channels and evidence
 * added, re-scored, seen count bumped). A business already in the CRM as an account is still
 * saved, linked to that account, so the inbox shows it as "already in CRM".
 */
export async function ingestLeads(intake: IntakeResult, opts: { source: string; createdById: string | null }): Promise<IntakeSummary> {
  const summary: IntakeSummary = { created: 0, updated: 0, alreadyInCrm: 0, needsProfile: 0, leads: [], errors: intake.errors };
  if (!intake.leads.length) return summary;
  const accounts = new DuplicateIndex(await db.account.findMany({ select: { id: true, domain: true, phone: true, name: true, city: true } }));
  // Match keys for every lead already in the inbox (small rows; phones are stored as typed, so
  // matching on digits happens here rather than in SQL).
  const existing = await db.prospectLead.findMany({ select: { id: true, domain: true, phone: true, name: true, city: true } });
  for (const lead of intake.leads) {
    const account = accounts.find(lead);
    if (account) summary.alreadyInCrm++;
    const hit = existing.find((r) => sameBusiness(r, lead));
    const prev = hit ? await db.prospectLead.findUnique({ where: { id: hit.id } }) : null;
    // Tell the skill which leads still need a company profile, so it researches only those:
    // none sent or stored yet, and not an account that already has a researched profile.
    const accountId = prev?.accountId ?? account?.id ?? null;
    const accountProfiled = accountId ? (await db.researchRun.count({ where: { accountId, kind: "RESEARCH", status: "DONE" } })) > 0 : false;
    const needsProfile = !lead.profile && !prev?.profile && !accountProfiled;
    if (needsProfile) summary.needsProfile++;
    summary.leads.push({ name: lead.name, status: prev ? "updated" : "created", inCrm: Boolean(account), needsProfile });
    if (prev) {
      const merged = mergeLead(leadFromRow(prev), lead);
      await db.prospectLead.update({
        where: { id: prev.id },
        data: {
          ...rowData(merged),
          searchIndustry: prev.searchIndustry || intake.search.industry,
          searchRegion: prev.searchRegion || intake.search.region,
          accountId: prev.accountId ?? account?.id ?? null,
          seenCount: { increment: 1 },
          lastSeenAt: new Date(),
        },
      });
      summary.updated++;
    } else {
      const row = await db.prospectLead.create({
        data: { ...rowData(lead), searchIndustry: intake.search.industry, searchRegion: intake.search.region, accountId: account?.id ?? null, source: opts.source, createdById: opts.createdById },
      });
      existing.push({ id: row.id, domain: row.domain, phone: row.phone, name: row.name, city: row.city });
      summary.created++;
    }
  }
  return summary;
}

export type PromoteResult = { created: number; linked: number; skipped: number; profiled: number };

/**
 * Save the skill's company profile as the account's Company profile, the same way the prospecting
 * skill's packs are saved: a research record, facts the write-up doesn't back up dropped, empty
 * fields filled, decision makers added as contacts. Unconfirmed matches fill nothing and flag the
 * account for review. Returns the research run id, or null when there was nothing usable.
 */
async function applyLeadProfile(accountId: string, row: LeadRow): Promise<string | null> {
  const lead = leadFromRow(row);
  if (!lead.profile) return null;
  const search = [row.searchIndustry, row.searchRegion].filter(Boolean).join(", ") || null;
  const p = profileProspect(lead.profile, lead, search ? `paying for leads — ${search}` : null);
  if (typeof p === "string" || !p.summary || !p.report) return null;
  // The lead's own findings (paid channels with proof, rating, buying signals) join the profile.
  const facts = leadFacts(lead, { industry: row.searchIndustry, region: row.searchRegion });
  const summary = withLeadFacts(p.summary, facts);
  const output = `Researched in Claude (your own plan) with the paid-lead prospects skill${search ? ` — search: ${search}` : ""}.\n\n${p.report}\n\n## Paying for leads\n${facts.report}`;
  const run = await db.researchRun.create({
    data: { kind: "RESEARCH", accountId, input: `Paid-lead prospects skill: company profile (facts only)${search ? ` — ${search}` : ""}`, output, resultJson: JSON.stringify(summary), status: "DONE", model: SKILL_MODEL, tokensIn: 0, tokensOut: 0, finishedAt: new Date() },
  });
  p.summary = summary;
  if (p.summary.match === "not_confirmed") {
    await db.account.update({ where: { id: accountId }, data: { needsReview: true, reviewReason: "The paid-lead skill couldn't confirm it found the right business, so no researched details were filled in. Check the website or phone number." } });
  } else {
    await applyResearchSummary(accountId, verifySummary(p.summary, output), false);
  }
  await recordActivity({ accountId, type: "RESEARCH", source: "system", subject: "Claude research: Company profile (paid-lead skill)", body: p.summary.keyFacts.join("\n") || null });
  return run.id;
}

export const LEAD_RESEARCH_MODEL = "Researched lead (no API)";

/**
 * A lead promoted without a company profile: its own findings (paid channels with proof, rating,
 * buying signals, opener) saved as research, combined with anything researched before, so the call
 * brief and research panel show them. The in-app company profile that follows only looks up what's
 * still missing. Skipped if this account already has the lead's research.
 */
async function recordLeadResearch(accountId: string, row: LeadRow): Promise<void> {
  const already = await db.researchRun.count({ where: { accountId, kind: "RESEARCH", input: { startsWith: "Researched lead" } } });
  if (already) return;
  const lead = leadFromRow(row);
  const search = { industry: row.searchIndustry, region: row.searchRegion };
  const facts = leadFacts(lead, search);
  if (!facts.keyFacts.length && !facts.painSignals.length) return;
  const priorRun = await db.researchRun.findFirst({ where: { accountId, kind: "RESEARCH", status: "DONE", resultJson: { not: null } }, orderBy: { createdAt: "desc" }, select: { resultJson: true } });
  const prior = safeJson<ResearchSummary | null>(priorRun?.resultJson, null);
  const base: ResearchSummary = prior ?? {
    match: "confirmed",
    fitScore: row.score,
    estMissedCallsPerWeek: null,
    avgJobValueUsd: null,
    industry: lead.industry ?? (row.searchIndustry || null),
    website: lead.website,
    city: lead.city,
    state: lead.region,
    phone: lead.phone,
    employees: null,
    keyFacts: [],
    painSignals: [],
    decisionMakers: [],
    suggestedOpener: "",
    kbQuestions: [],
  };
  const summary = withLeadFacts({ ...base, suggestedOpener: facts.opener || base.suggestedOpener }, facts);
  const label = [search.industry, search.region].filter(Boolean).join(", ");
  await db.researchRun.create({
    data: { kind: "RESEARCH", accountId, input: `Researched lead${label ? `: ${label}` : ""}`, output: facts.report, resultJson: JSON.stringify(summary), status: "DONE", model: LEAD_RESEARCH_MODEL, tokensIn: 0, tokensOut: 0, finishedAt: new Date() },
  });
}

/**
 * Promote leads to the CRM. "prospects": an Account at stage Prospect (it appears in the
 * pipeline and in the dialer's full list). "dialer": the same, tagged call-list with a
 * follow-up due today, so it tops the dialer's Call list. Existing accounts are linked and
 * tagged rather than duplicated (only when this user may work them).
 */
export async function promoteLeads(ids: string[], mode: "prospects" | "dialer", session: { sub: string; role: string }, canUpdate: (ownerId: string | null) => boolean): Promise<PromoteResult> {
  const leads = await db.prospectLead.findMany({ where: { id: { in: ids }, status: { not: "DISMISSED" } } });
  const toDialer = mode === "dialer";
  const result: PromoteResult = { created: 0, linked: 0, skipped: 0, profiled: 0 };
  const newAccountIds: string[] = [];
  const profiledIds: string[] = [];
  const profileRunIds: string[] = [];
  for (const row of leads) {
    const lead = leadFromRow(row);
    const tags = promotionTags(lead.channels, toDialer);
    const notes = promotionNotes(lead, { industry: row.searchIndustry, region: row.searchRegion });
    let accountId = row.accountId && (await db.account.findUnique({ where: { id: row.accountId }, select: { id: true } }))?.id;
    if (!accountId) {
      const res = await importRows(
        [{
          rowNumber: 1,
          account: { name: lead.name, domain: lead.domain ?? normalizeDomain(lead.website), website: lead.website, phone: lead.phone, industry: lead.industry ?? (row.searchIndustry || null), city: lead.city, state: lead.region, employees: null, stage: null, tags, notes, avgJobValueCents: null },
          contact: null,
        }],
        { source: "claude", ownerId: session.sub, updateExisting: true, canUpdate },
      );
      if (res.createdIds[0]) {
        accountId = res.createdIds[0];
        newAccountIds.push(accountId);
        result.created++;
      } else {
        // importRows matched an existing account (or another rep's, which it leaves alone).
        const match = await db.account.findFirst({ where: { OR: [...(lead.domain ? [{ domain: lead.domain }] : []), { name: { equals: lead.name, mode: "insensitive" as const } }] }, select: { id: true } });
        accountId = match?.id;
      }
    }
    if (!accountId) {
      result.skipped++;
      continue;
    }
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, ownerId: true, tags: true, notes: true, fitScore: true, nextFollowUpAt: true, domain: true, website: true, phone: true, industry: true, city: true, state: true } });
    if (!newAccountIds.includes(accountId)) {
      if (!canUpdate(account.ownerId)) {
        result.skipped++;
        await db.prospectLead.update({ where: { id: row.id }, data: { accountId } });
        continue;
      }
      result.linked++;
    }
    await db.account.update({
      where: { id: accountId },
      data: {
        tags: joinTags([...splitTags(account.tags), ...tags]),
        notes: account.notes.includes("Researched lead") ? account.notes : `${account.notes}\n${notes}`.trim(),
        fitScore: account.fitScore ?? row.score,
        // Fill in what the account doesn't have yet from the lead (never overwrite).
        phone: account.phone ?? lead.phone,
        industry: account.industry ?? (lead.industry ?? (row.searchIndustry || null)),
        city: account.city ?? lead.city,
        state: account.state ?? lead.region,
        ...(!account.website && !account.domain && lead.website && !(lead.domain && (await db.account.findFirst({ where: { domain: lead.domain, id: { not: accountId } }, select: { id: true } }))) ? { website: websiteUrl(lead.website), domain: lead.domain } : {}),
        ...(toDialer && (!account.nextFollowUpAt || account.nextFollowUpAt > new Date()) ? { nextFollowUpAt: new Date() } : {}),
      },
    });
    // The skill's company profile: on new accounts, and on matched accounts with no profile yet.
    const hasProfile = !newAccountIds.includes(accountId) && (await db.researchRun.count({ where: { accountId, kind: "RESEARCH", status: "DONE" } })) > 0;
    if (row.profile && !hasProfile) {
      try {
        const runId = await applyLeadProfile(accountId, row);
        if (runId) {
          profileRunIds.push(runId);
          profiledIds.push(accountId);
          result.profiled++;
        }
      } catch (e) {
        console.warn("lead profile", row.id, e);
      }
    }
    // No usable profile: still save what the lead research found (paid channels, proof, signals).
    if (!profiledIds.includes(accountId)) await recordLeadResearch(accountId, row).catch((e) => console.warn("lead research", row.id, e));
    await db.prospectLead.update({ where: { id: row.id }, data: { accountId, status: toDialer ? "DIALER" : "PROSPECT" } });
  }
  // New accounts without a skill profile get the in-app fact-only profile research instead.
  const needResearch = newAccountIds.filter((id) => !profiledIds.includes(id));
  if (needResearch.length) await researchNewAccounts(needResearch);
  const profiledNew = profiledIds.filter((id) => newAccountIds.includes(id));
  if (profileRunIds.length || profiledNew.length) {
    after(async () => {
      for (const id of profileRunIds) await archiveRunToDrive(id).catch((e) => console.warn("Drive archive skipped:", (e as Error).message));
      const { backfillAccountEmail } = await import("./outreach");
      for (const id of profiledNew) await backfillAccountEmail(id).catch((e) => console.warn("email backfill", id, e));
    });
  }
  return result;
}
