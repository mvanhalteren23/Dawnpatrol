import "server-only";
import { after } from "next/server";
import { db } from "./db";
import type { Prospect } from "./ai";
import { importRows } from "./importer";
import { applyResearchSummary, archiveRunToDrive } from "./jobs";
import { recordActivity } from "./outreach";
import { verifySummary } from "./research-guard";
import { DuplicateIndex, canTouch } from "./team-rules";
import { packImportRow, packReportText, type ParsedPack } from "./prospect-pack-rules";
import type { SessionPayload } from "./session";

export const SKILL_MODEL = "Claude (your plan, via the skill)";

export type PackResult = { name: string; status: "added" | "exists" | "error"; accountId: string | null; researched: boolean; message?: string };
export type SkillRunJson = { count: number; prospects: Prospect[]; skill: { results: PackResult[]; problems: string[] } };

/**
 * Add a prospect pack to the CRM: new accounts with the skill's research applied exactly as the
 * in-app research would (facts the write-up doesn't back up are dropped), contacts, a research
 * record per business and a prospect-search record. Nothing here calls a paid AI API; the
 * Gmail search and Drive copy that follow are Google calls.
 */
export async function importPack(pack: ParsedPack, session: SessionPayload, extraTags: string[] = []): Promise<{ runId: string; results: PackResult[] }> {
  const tags = ["claude-prospect", "claude-skill", ...extraTags.map((t) => t.trim()).filter(Boolean)];
  const imported = await importRows(pack.prospects.map((p) => packImportRow(p, tags)), {
    source: "claude",
    ownerId: session.sub,
    updateExisting: false,
    canUpdate: (ownerId) => canTouch(session, ownerId),
  });
  const created = new Set(imported.createdIds);
  const index = new DuplicateIndex(await db.account.findMany({ select: { id: true, name: true, domain: true, phone: true, city: true, ownerId: true } }));
  const results: PackResult[] = [];
  const researchRunIds: string[] = [];

  for (const p of pack.prospects) {
    const hit = index.find({ domain: p.domain, phone: p.phone, name: p.name, city: p.city });
    if (!hit) {
      results.push({ name: p.name, status: "error", accountId: null, researched: false, message: imported.errors.find((e) => e.row === p.index + 1)?.message ?? "Couldn't be added" });
      continue;
    }
    if (!created.has(hit.id)) {
      results.push({ name: p.name, status: "exists", accountId: hit.id, researched: false });
      continue;
    }
    let researched = false;
    try {
      if (p.fitScore != null) await db.account.update({ where: { id: hit.id }, data: { fitScore: p.fitScore } });
      if (p.summary && p.report) {
        const output = packReportText(p, pack.criteria);
        const run = await db.researchRun.create({
          data: { kind: "RESEARCH", accountId: hit.id, input: `Prospecting skill: ${pack.criteria ?? "prospect search"}`, output, resultJson: JSON.stringify(p.summary), status: "DONE", model: SKILL_MODEL, tokensIn: 0, tokensOut: 0, finishedAt: new Date() },
        });
        researchRunIds.push(run.id);
        if (p.summary.match === "not_confirmed") {
          await db.account.update({ where: { id: hit.id }, data: { needsReview: true, reviewReason: "The Claude skill couldn't confirm it found the right business, so no researched details were filled in. Check the website or phone number." } });
        } else {
          await applyResearchSummary(hit.id, verifySummary(p.summary, output), false);
          researched = true;
        }
        await recordActivity({ accountId: hit.id, type: "RESEARCH", source: "system", subject: "Claude research (prospecting skill)", body: p.summary.keyFacts.join("\n") || null });
      }
      // Extra contacts beyond the first (the first came in with the import row).
      if (!p.summary) {
        for (const c of p.contacts.slice(1)) {
          if (c.email && (await db.contact.findFirst({ where: { accountId: hit.id, email: c.email } }))) continue;
          await db.contact.create({ data: { accountId: hit.id, ...c } });
        }
      }
      results.push({ name: p.name, status: "added", accountId: hit.id, researched });
    } catch (err) {
      results.push({ name: p.name, status: "added", accountId: hit.id, researched: false, message: `Added, but the research couldn't be saved: ${(err as Error).message}` });
    }
  }

  const prospects: Prospect[] = pack.prospects.map((p) => ({
    name: p.name, website: p.website, phone: p.phone, industry: p.industry, city: p.city, state: p.state, employees: p.employees,
    fitScore: p.fitScore ?? 0, whyFit: p.whyFit ?? "", contactName: [p.contacts[0]?.firstName, p.contacts[0]?.lastName].filter(Boolean).join(" ") || null,
    contactTitle: p.contacts[0]?.title ?? null, contactEmail: p.contacts[0]?.email ?? null, sourceUrl: null,
  }));
  const added = results.filter((r) => r.status === "added").length;
  const json: SkillRunJson = { count: pack.prospects.length, prospects, skill: { results, problems: pack.problems } };
  const run = await db.researchRun.create({
    data: {
      kind: "PROSPECTING",
      input: `Prospecting skill: ${pack.criteria ?? "prospect search"}`,
      output: `Found in Claude with the Head Above prospecting skill. ${added} added, ${results.filter((r) => r.status === "exists").length} already in the CRM.`,
      resultJson: JSON.stringify(json),
      status: "DONE",
      model: SKILL_MODEL,
      tokensIn: 0,
      tokensOut: 0,
      finishedAt: new Date(),
    },
  });

  const newIds = results.filter((r) => r.status === "added" && r.accountId).map((r) => r.accountId!);
  after(async () => {
    for (const id of researchRunIds) await archiveRunToDrive(id).catch((e) => console.warn("Drive archive skipped:", (e as Error).message));
    const { backfillAccountEmail } = await import("./outreach");
    for (const id of newIds) await backfillAccountEmail(id).catch((e) => console.warn("email backfill", id, e));
  });
  return { runId: run.id, results };
}

/** Which of these businesses are already in the CRM (so the skill doesn't research them again). */
export async function knownBusinesses(candidates: { name?: string | null; website?: string | null; phone?: string | null; city?: string | null }[]) {
  const { normalizeDomain } = await import("./utils");
  const index = new DuplicateIndex(await db.account.findMany({ select: { id: true, name: true, domain: true, phone: true, city: true } }));
  return candidates.slice(0, 200).map((c) => {
    const hit = index.find({ domain: normalizeDomain(c.website), phone: c.phone, name: c.name, city: c.city });
    return { name: c.name ?? null, known: Boolean(hit), accountName: hit?.name ?? null };
  });
}
