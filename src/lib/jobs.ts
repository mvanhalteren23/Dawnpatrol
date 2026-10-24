import "server-only";
import { after } from "next/server";
import { db } from "./db";
import { discoverProspects, draftKnowledgeBase, researchAccount, type ResearchSummary } from "./ai";
import { writeAccountDoc } from "./drive";
import { googleConnection } from "./google";
import { accountVariables, COMPANY_PROFILE_PROMPT, COMPANY_PROFILE_PROMPT_NAME, renderPrompt } from "./prompts";
import { verifySummary } from "./research-guard";
import { getSetting } from "./settings";
import { aiConfigured } from "./ai";
import { companyName } from "./brand";
import { recordActivity } from "./outreach";
import { normalizeDomain, websiteUrl } from "./utils";

// Long-running Claude work runs after the response is sent (next/server `after`), writing
// progress to ResearchRun. Pages poll with <AutoRefresh>.

async function fail(runId: string, err: unknown) {
  console.error(`run ${runId} failed`, err);
  await db.researchRun.update({ where: { id: runId }, data: { status: "FAILED", error: (err as Error).message?.slice(0, 2000) ?? String(err), finishedAt: new Date() } });
}

export async function startAccountResearch(accountId: string, promptId: string | null, customPrompt?: string): Promise<string> {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { contacts: true } });
  const prompt = promptId ? await db.savedPrompt.findUnique({ where: { id: promptId } }) : null;
  const template = customPrompt || prompt?.template;
  if (!template) throw new Error("Choose a saved prompt or write one");
  const input = renderPrompt(template, { ...accountVariables(account), my_company: await companyName() });
  const run = await db.researchRun.create({ data: { kind: "RESEARCH", accountId, promptId: prompt?.id ?? null, input } });
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
  if (runIds.length) {
    after(async () => {
      for (let i = 0; i < runIds.length; i += 3) await Promise.all(runIds.slice(i, i + 3).map((r) => executeAccountResearch(r)));
    });
  }
  return runIds.length;
}

export async function executeAccountResearch(runId: string) {
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId }, include: { account: true, prompt: true } });
  try {
    const result = await researchAccount(run.input);
    await db.researchRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        output: result.text,
        resultJson: result.summary ? JSON.stringify(result.summary) : null,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        finishedAt: new Date(),
      },
    });
    if (run.accountId && result.summary) {
      if (result.summary.match === "not_confirmed") {
        // Don't fill anything in from a profile of what may be a different business.
        await db.account.update({ where: { id: run.accountId }, data: { needsReview: true, reviewReason: "Research couldn't confirm it found the right business, so no details were filled in. Add the website or phone number and re-run research." } });
      } else {
        await applyResearchSummary(run.accountId, verifySummary(result.summary, result.text), false);
      }
    }
    if (run.accountId) {
      await recordActivity({ accountId: run.accountId, type: "RESEARCH", source: "system", subject: `Claude research: ${run.prompt?.name ?? "custom prompt"}`, body: result.summary?.keyFacts.join("\n") ?? null });
      await archiveRunToDrive(runId).catch((e) => console.warn("Drive archive skipped:", (e as Error).message));
    }
  } catch (err) {
    await fail(runId, err);
  }
}

/** Fill empty account fields from research; `overwrite` replaces existing values too. Adds new decision makers as contacts. */
export async function applyResearchSummary(accountId: string, s: ResearchSummary, overwrite: boolean) {
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
      data: result.items.map((i) => ({ receptionistId, category: i.category, title: i.title, content: i.content, tags: "claude-draft", isActive: false, updatedBy: "claude" })),
    });
    await db.researchRun.update({
      where: { id: runId },
      data: { status: "DONE", output: result.text, resultJson: JSON.stringify({ items: result.items.length }), model: result.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, finishedAt: new Date() },
    });
  } catch (err) {
    await fail(runId, err);
  }
}
