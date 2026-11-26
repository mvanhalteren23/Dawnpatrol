import "server-only";
import { after } from "next/server";
import { db } from "./db";
import { discoverProspects, draftKnowledgeBase, researchAccount, type ResearchSummary } from "./ai";
import { writeAccountDoc } from "./drive";
import { googleConnection } from "./google";
import { accountVariables, COMPANY_PROFILE_PROMPT, COMPANY_PROFILE_PROMPT_NAME, renderPrompt } from "./prompts";
import { verifySummary } from "./research-guard";
import { cleanQuestions } from "./discovery-rules";
import { looksLikeInstructions } from "./safety-rules";
import { getSetting } from "./settings";
import { aiConfigured } from "./ai";
import { companyName } from "./brand";
import { recordActivity } from "./outreach";
import { normalizeDomain, safeJson, websiteUrl } from "./utils";
import { carryForward, changedFields, gapsBudget, gapsPrompt, knownProfile, missingItems, updatePrompt, type KnownInput } from "./research-gaps";

// Long-running Claude work runs after the response is sent (next/server `after`), writing
// progress to ResearchRun. Pages poll with <AutoRefresh>.

async function fail(runId: string, err: unknown) {
  console.error(`run ${runId} failed`, err);
  await db.researchRun.update({ where: { id: runId }, data: { status: "FAILED", error: (err as Error).message?.slice(0, 2000) ?? String(err), finishedAt: new Date() } });
}

export type ResearchMode = "full" | "gaps" | "update";

/** What's already known about the account: its fields, contacts and earlier research (newest first). */
export async function knownInputFor(accountId: string, excludeRunId?: string): Promise<KnownInput> {
  const a = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { contacts: true } });
  const runs = await db.researchRun.findMany({ where: { accountId, kind: "RESEARCH", status: "DONE", ...(excludeRunId ? { id: { not: excludeRunId } } : {}) }, orderBy: { createdAt: "desc" }, take: 4, select: { output: true, resultJson: true } });
  return {
    account: { name: a.name, website: a.website, phone: a.phone, city: a.city, state: a.state, industry: a.industry, employees: a.employees, notes: a.notes },
    contacts: a.contacts,
    reports: runs.map((r) => r.output.slice(0, 6000)),
    summaries: runs.map((r) => safeJson<{ keyFacts?: string[]; decisionMakers?: { name: string; title: string | null }[] }>(r.resultJson, {})),
  };
}

/**
 * Start a research run; returns its id, or null when there's nothing to research.
 * The company profile prompt only looks for what isn't known yet ("gaps"); `mode: "update"`
 * re-checks what's known for changes.
 */
export async function startAccountResearch(accountId: string, promptId: string | null, customPrompt?: string, opts: { mode?: "update" } = {}): Promise<string | null> {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { contacts: true } });
  if (opts.mode === "update") {
    const known = knownProfile(await knownInputFor(accountId));
    const input = updatePrompt(account.name, known, new Date().toISOString().slice(0, 10));
    const run = await db.researchRun.create({ data: { kind: "RESEARCH", accountId, mode: "update", input } });
    return run.id;
  }
  const prompt = promptId ? await db.savedPrompt.findUnique({ where: { id: promptId } }) : null;
  const template = customPrompt || prompt?.template;
  if (!template) throw new Error("Choose a saved prompt or write one");
  let input = renderPrompt(template, { ...accountVariables(account), my_company: await companyName() });
  let mode: ResearchMode = "full";
  // The company profile adds to what's known rather than researching it all again.
  if (prompt?.name === COMPANY_PROFILE_PROMPT_NAME || customPrompt === COMPANY_PROFILE_PROMPT) {
    const gaps = gapsPrompt(input, knownProfile(await knownInputFor(accountId)));
    if (!gaps) return null;
    input = gaps.prompt;
    mode = "gaps";
  }
  const run = await db.researchRun.create({ data: { kind: "RESEARCH", accountId, promptId: prompt?.id ?? null, input, mode } });
  return run.id;
}

export const AUTO_RESEARCH_KEY = "research.autoNewAccounts";

export async function autoResearchEnabled(): Promise<boolean> {
  return (await getSetting(AUTO_RESEARCH_KEY)) !== "off" && aiConfigured();
}

/**
 * Every new account gets a fact-only company profile (the saved prompt of that name if you've
 * edited it, else the built-in one). Returns the run id; the caller runs it with
 * executeAccountResearch after responding (next/server `after`). Null when turned off.
 */
export async function queueProfileResearch(accountId: string): Promise<string | null> {
  if (!(await autoResearchEnabled())) return null;
  const busy = await db.researchRun.count({ where: { accountId, kind: "RESEARCH", status: "RUNNING" } });
  if (busy) return null;
  const prompt = await db.savedPrompt.findFirst({ where: { kind: "RESEARCH", name: COMPANY_PROFILE_PROMPT_NAME } });
  return startAccountResearch(accountId, prompt?.id ?? null, prompt ? undefined : COMPANY_PROFILE_PROMPT);
}

/** Up to this many new accounts per batch (import, prospect list) are researched automatically. */
export const AUTO_RESEARCH_BATCH_LIMIT = 10;

/** Queue profile research for new accounts and run it (3 at a time) after the response. */
export async function researchNewAccounts(accountIds: string[]): Promise<number> {
  const runIds: string[] = [];
  for (const id of accountIds.slice(0, AUTO_RESEARCH_BATCH_LIMIT)) {
    const runId = await queueProfileResearch(id);
    if (runId) runIds.push(runId);
  }
  const ids = accountIds.slice(0, AUTO_RESEARCH_BATCH_LIMIT);
  after(async () => {
    for (let i = 0; i < runIds.length; i += 3) await Promise.all(runIds.slice(i, i + 3).map((r) => executeAccountResearch(r)));
    // Then their past emails (research may have found the website, so the domain search finds more).
    const { backfillAccountEmail } = await import("./outreach");
    for (const id of ids) await backfillAccountEmail(id).catch((e) => console.warn("email backfill", id, e));
  });
  return runIds.length;
}

const UPDATE_FIELDS: Record<string, string> = { website: "Website", phone: "Phone", city: "City", state: "Province/state", industry: "Industry", employees: "Team size" };

export async function executeAccountResearch(runId: string) {
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId }, include: { account: true, prompt: true } });
  const mode = (run.mode === "gaps" || run.mode === "update" ? run.mode : "full") as ResearchMode;
  try {
    const budget = mode === "gaps" && run.accountId ? gapsBudget(missingItems(knownProfile(await knownInputFor(run.accountId, runId))).length) : undefined;
    const result = await researchAccount(run.input, budget);
    // The call brief reads the newest research: carry earlier facts, signals and opener forward.
    const prior = mode !== "full" && run.accountId
      ? safeJson<Partial<ResearchSummary> | null>((await db.researchRun.findFirst({ where: { accountId: run.accountId, kind: "RESEARCH", status: "DONE", resultJson: { not: null }, id: { not: runId } }, orderBy: { createdAt: "desc" }, select: { resultJson: true } }))?.resultJson, null)
      : null;
    const summary = result.summary && mode !== "full" ? carryForward(result.summary, prior as Partial<ResearchSummary> | null, mode) : result.summary;
    await db.researchRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        output: result.text,
        resultJson: summary ? JSON.stringify(summary) : null,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        finishedAt: new Date(),
      },
    });
    let changes: string[] = [];
    if (run.accountId && summary) {
      if (summary.match === "not_confirmed") {
        // Don't fill anything in from a profile of what may be a different business.
        await db.account.update({ where: { id: run.accountId }, data: { needsReview: true, reviewReason: "Research couldn't confirm it found the right business, so no details were filled in. Add the website or phone number and re-run research." } });
      } else if (mode === "update") {
        const before = await db.account.findUniqueOrThrow({ where: { id: run.accountId } });
        await applyResearchSummary(run.accountId, verifySummary(summary, result.text), true, { keepQuestions: true });
        const after = await db.account.findUniqueOrThrow({ where: { id: run.accountId } });
        changes = changedFields(before, after, UPDATE_FIELDS);
      } else {
        await applyResearchSummary(run.accountId, verifySummary(summary, result.text), false);
      }
    }
    if (run.accountId) {
      const subject = mode === "update" ? `Claude research: information updated (${changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}` : "no field changes"})` : `Claude research: ${run.prompt?.name ?? "custom prompt"}${mode === "gaps" ? " (missing details only)" : ""}`;
      const body = mode === "update" ? [changes.length ? `Changed:\n${changes.join("\n")}` : "The account's fields are still current.", ...(summary?.keyFacts.slice(0, 4) ?? [])].join("\n") : summary?.keyFacts.join("\n") ?? null;
      await recordActivity({ accountId: run.accountId, type: "RESEARCH", source: "system", subject, body });
      await archiveRunToDrive(runId).catch((e) => console.warn("Drive archive skipped:", (e as Error).message));
    }
  } catch (err) {
    await fail(runId, err);
  }
}

/** Fill empty account fields from research; `overwrite` replaces existing values too. Adds new decision makers as contacts. */
export async function applyResearchSummary(accountId: string, s: ResearchSummary, overwrite: boolean, opts: { keepQuestions?: boolean } = {}) {
  const a = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { contacts: true } });
  const pick = <T,>(current: T | null, next: T | null) => (overwrite ? next ?? current : current ?? next);
  // Only take the website's domain if no other account already has it (domain is unique).
  const foundDomain = normalizeDomain(s.website);
  const domainFree = foundDomain && (overwrite || !a.domain) && !(await db.account.findFirst({ where: { domain: foundDomain, id: { not: accountId } } }));
  await db.account.update({
    where: { id: accountId },
    data: {
      fitScore: s.fitScore ?? a.fitScore,
      industry: pick(a.industry, s.industry),
      ...(domainFree ? { domain: foundDomain, website: pick(a.website, websiteUrl(s.website)) } : {}),
      city: pick(a.city, s.city),
      state: pick(a.state, s.state),
      phone: pick(a.phone, s.phone),
      employees: pick(a.employees, s.employees),
      estMissedCallsPerWeek: pick(a.estMissedCallsPerWeek, s.estMissedCallsPerWeek),
      avgJobValueCents: pick(a.avgJobValueCents, s.avgJobValueUsd != null ? Math.round(s.avgJobValueUsd * 100) : null),
      // Like the other fields: questions edited by hand stay unless research is applied with overwrite.
      ...(((overwrite && !opts.keepQuestions) || !a.discoveryQuestions) && cleanQuestions(s.kbQuestions).length ? { discoveryQuestions: JSON.stringify(cleanQuestions(s.kbQuestions)) } : {}),
    },
  });
  const known = new Set(a.contacts.map((c) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim().toLowerCase()));
  const knownEmails = new Set(a.contacts.map((c) => c.email?.toLowerCase()).filter(Boolean));
  for (const dm of s.decisionMakers) {
    if (known.has(dm.name.trim().toLowerCase()) || (dm.email && knownEmails.has(dm.email.toLowerCase()))) continue;
    const [firstName, ...rest] = dm.name.trim().split(/\s+/);
    await db.contact.create({
      data: { accountId, firstName: firstName ?? null, lastName: rest.join(" ") || null, title: dm.title, email: dm.email?.toLowerCase() ?? null, phone: dm.phone, linkedin: dm.linkedin, isPrimary: a.contacts.length === 0 },
    });
  }
}

export async function archiveRunToDrive(runId: string) {
  const { connected } = await googleConnection();
  if (!connected) return null;
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId }, include: { account: true, prompt: true } });
  if (!run.accountId || !run.account) return null;
  const date = run.createdAt.toISOString().slice(0, 10);
  const name = `${date} — ${run.prompt?.name ?? "Research"} — ${run.account.name}`;
  const content = `${name}\n\nPrompt:\n${run.input}\n\n---\n\n${run.output}`;
  const file = await writeAccountDoc(run.accountId, "RESEARCH", name, content, run.driveFileId);
  await db.researchRun.update({ where: { id: runId }, data: { driveFileId: file.id, driveFileUrl: file.url } });
  return file;
}

export async function startProspecting(promptId: string | null, criteria: string, count: number, customPrompt?: string): Promise<string> {
  const prompt = promptId ? await db.savedPrompt.findUnique({ where: { id: promptId } }) : null;
  const template = customPrompt || prompt?.template || "Find {{count}} businesses matching: {{criteria}}";
  const input = renderPrompt(template, { criteria, count, my_company: await companyName() });
  const run = await db.researchRun.create({ data: { kind: "PROSPECTING", promptId: prompt?.id ?? null, input, resultJson: JSON.stringify({ count }) } });
  return run.id;
}

export async function executeProspecting(runId: string) {
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId } });
  const count = (JSON.parse(run.resultJson ?? "{}") as { count?: number }).count ?? 10;
  try {
    const result = await discoverProspects(run.input, count);
    await db.researchRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        output: result.text,
        resultJson: JSON.stringify({ count, prospects: result.prospects }),
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await fail(runId, err);
  }
}

export async function startKbDraft(receptionistId: string): Promise<string> {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, include: { account: true } });
  const website = r.account.website ?? (r.account.domain ? `https://${r.account.domain}` : null);
  if (!website) throw new Error("Add the client's website to the account first");
  const run = await db.researchRun.create({
    data: { kind: "KB_DRAFT", accountId: r.accountId, input: JSON.stringify({ receptionistId, website, businessName: r.businessName, notes: r.account.notes }) },
  });
  return run.id;
}

export async function executeKbDraft(runId: string) {
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId } });
  const { receptionistId, website, businessName, notes } = JSON.parse(run.input) as { receptionistId: string; website: string; businessName: string; notes: string };
  try {
    const result = await draftKnowledgeBase(businessName, website, notes);
    // Drafts land inactive and tagged so a human reviews before the receptionist uses them.
    await db.knowledgeItem.createMany({
      // Website text that reads like instructions to an AI is dropped (prompt injection via a website).
      data: result.items.filter((i) => !looksLikeInstructions(`${i.title}\n${i.content}`)).map((i) => ({ receptionistId, category: i.category, title: i.title, content: i.content, tags: "claude-draft", isActive: false, updatedBy: "claude" })),
    });
    await db.researchRun.update({
      where: { id: runId },
      data: { status: "DONE", output: result.text, resultJson: JSON.stringify({ items: result.items.length }), model: result.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, finishedAt: new Date() },
    });
  } catch (err) {
    await fail(runId, err);
  }
}
