import "server-only";
import { db } from "./db";
import { importRows } from "./importer";
import { researchNewAccounts } from "./jobs";
import { DuplicateIndex } from "./team-rules";
import { joinTags, normalizeDomain, safeJson, splitTags } from "./utils";
import {
  mergeLead,
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
  };
}

export type IntakeSummary = { created: number; updated: number; alreadyInCrm: number; errors: { index: number; message: string }[] };

/**
 * Save researched leads. A business already in the inbox is merged (new channels and evidence
 * added, re-scored, seen count bumped). A business already in the CRM as an account is still
 * saved, linked to that account, so the inbox shows it as "already in CRM".
 */
export async function ingestLeads(intake: IntakeResult, opts: { source: string; createdById: string | null }): Promise<IntakeSummary> {
  const summary: IntakeSummary = { created: 0, updated: 0, alreadyInCrm: 0, errors: intake.errors };
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

export type PromoteResult = { created: number; linked: number; skipped: number };

/**
 * Promote leads to the CRM. "prospects": an Account at stage Prospect (it appears in the
 * pipeline and in the dialer's full list). "dialer": the same, tagged call-list with a
 * follow-up due today, so it tops the dialer's Call list. Existing accounts are linked and
 * tagged rather than duplicated (only when this user may work them).
 */
export async function promoteLeads(ids: string[], mode: "prospects" | "dialer", session: { sub: string; role: string }, canUpdate: (ownerId: string | null) => boolean): Promise<PromoteResult> {
  const leads = await db.prospectLead.findMany({ where: { id: { in: ids }, status: { not: "DISMISSED" } } });
  const toDialer = mode === "dialer";
  const result: PromoteResult = { created: 0, linked: 0, skipped: 0 };
  const newAccountIds: string[] = [];
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
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, ownerId: true, tags: true, notes: true, fitScore: true, nextFollowUpAt: true } });
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
        ...(toDialer && (!account.nextFollowUpAt || account.nextFollowUpAt > new Date()) ? { nextFollowUpAt: new Date() } : {}),
      },
    });
    await db.prospectLead.update({ where: { id: row.id }, data: { accountId, status: toDialer ? "DIALER" : "PROSPECT" } });
  }
  // New accounts get the same fact-only profile research as other Claude-added accounts.
  if (newAccountIds.length) await researchNewAccounts(newAccountIds);
  return result;
}
