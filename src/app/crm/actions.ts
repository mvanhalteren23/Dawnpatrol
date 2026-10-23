"use server";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { STAGES, type Stage } from "@/lib/constants";
import { addDays, joinTags, normalizeDomain, optInt, optStr, parseMoneyToCents, safeJson, str, websiteUrl } from "@/lib/utils";
import { changeStage, recordActivity, sendTrackedEmail, syncGmail, writeOutreachLog } from "@/lib/outreach";
import { ensureAccountFolders } from "@/lib/drive";
import { importCsvText, importRows } from "@/lib/importer";
import {
  applyResearchSummary,
  archiveRunToDrive,
  executeAccountResearch,
  executeKbDraft,
  executeProspecting,
  startAccountResearch,
  startKbDraft,
  startProspecting,
} from "@/lib/jobs";
import { draftOutreachEmail, type Prospect, type ResearchSummary } from "@/lib/claude";
import { accountVariables, renderPrompt } from "@/lib/prompts";
import { companyName, renameCompany } from "@/lib/brand";
import { createCheckout, setManualSubscription } from "@/lib/billing";
import { markDirty, syncReceptionist } from "@/lib/elevenlabs";
import { availability } from "@/lib/agent-booking";
import { parseWeeklyHours } from "@/lib/booking";
import { cleanDigits, nextFreeExtension } from "@/lib/twilio";
import { demoExtensionForAccount, demoLineConfig, formatPhone } from "@/lib/demo-line";

function back(path: string, params?: Record<string, string>): never {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  revalidatePath(path);
  redirect(`${path}${qs}`);
}

function errMsg(err: unknown) {
  return (err as Error)?.message ?? String(err);
}

// --- Accounts -----------------------------------------------------------------

export async function createAccount(form: FormData) {
  const session = await requireAdmin();
  const website = optStr(form, "website");
  const domain = normalizeDomain(website);
  if (domain) {
    const existing = await db.account.findUnique({ where: { domain } });
    if (existing) back(`/crm/accounts/${existing.id}`, { notice: "An account with that domain already exists" });
  }
  const account = await db.account.create({
    data: {
      name: str(form, "name") || domain || "Untitled",
      domain,
      website: websiteUrl(website),
      phone: optStr(form, "phone"),
      industry: optStr(form, "industry"),
      city: optStr(form, "city"),
      state: optStr(form, "state"),
      stage: (STAGES as readonly string[]).includes(str(form, "stage")) ? str(form, "stage") : "PROSPECT",
      tags: joinTags(str(form, "tags").split(",")),
      notes: str(form, "notes"),
      ownerId: session.sub,
      source: "manual",
    },
  });
  const contactEmail = optStr(form, "contactEmail");
  const contactName = optStr(form, "contactName");
  if (contactEmail || contactName) {
    const [firstName, ...rest] = (contactName ?? "").split(/\s+/);
    await db.contact.create({
      data: { accountId: account.id, firstName: firstName || null, lastName: rest.join(" ") || null, email: contactEmail?.toLowerCase() ?? null, title: optStr(form, "contactTitle"), isPrimary: true },
    });
  }
  back(`/crm/accounts/${account.id}`);
}

export async function updateAccount(accountId: string, form: FormData) {
  await requireAdmin();
  const website = optStr(form, "website");
  const domain = normalizeDomain(website);
  const avg = parseMoneyToCents(optStr(form, "avgJobValue"));
  try {
    await db.account.update({
      where: { id: accountId },
      data: {
        needsReview: false, // saving the details counts as reviewing them
        name: str(form, "name"),
        website: websiteUrl(website),
        domain,
        phone: optStr(form, "phone"),
        industry: optStr(form, "industry"),
        city: optStr(form, "city"),
        state: optStr(form, "state"),
        employees: optInt(form, "employees"),
        fitScore: optInt(form, "fitScore"),
        estMissedCallsPerWeek: optInt(form, "estMissedCallsPerWeek"),
        avgJobValueCents: avg,
        tags: joinTags(str(form, "tags").split(",")),
        notes: str(form, "notes"),
        nextFollowUpAt: optStr(form, "nextFollowUpAt") ? new Date(str(form, "nextFollowUpAt")) : null,
      },
    });
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: `Could not save: ${errMsg(err)}` });
  }
  const stage = str(form, "stage");
  if ((STAGES as readonly string[]).includes(stage)) await changeStage(accountId, stage as Stage, (await requireAdmin()).sub);
  back(`/crm/accounts/${accountId}`, { notice: "Saved" });
}

export async function setStage(accountId: string, stage: string) {
  const session = await requireAdmin();
  if (!(STAGES as readonly string[]).includes(stage)) return;
  await changeStage(accountId, stage as Stage, session.sub);
  revalidatePath("/crm/pipeline");
  revalidatePath(`/crm/accounts/${accountId}`);
}

export async function deleteAccount(accountId: string) {
  await requireAdmin();
  await db.account.delete({ where: { id: accountId } });
  back("/crm/accounts", { notice: "Account deleted" });
}

export async function bulkAccounts(form: FormData) {
  const session = await requireAdmin();
  const ids = form.getAll("ids").map(String).filter(Boolean);
  const op = str(form, "op");
  if (!ids.length) back("/crm/accounts", { error: "Select at least one account" });
  if (op === "delete") {
    await db.account.deleteMany({ where: { id: { in: ids } } });
  } else if (op.startsWith("stage:")) {
    for (const id of ids) await changeStage(id, op.slice(6) as Stage, session.sub);
  } else if (op === "research") {
    const promptId = str(form, "promptId") || (await db.savedPrompt.findFirst({ where: { kind: "RESEARCH", isDefault: true } }))?.id;
    if (!promptId) back("/crm/accounts", { error: "Create a research prompt first" });
    const runIds: string[] = [];
    for (const id of ids.slice(0, 25)) runIds.push(await startAccountResearch(id, promptId));
    after(async () => {
      // Sequential to stay friendly with rate limits.
      for (const runId of runIds) await executeAccountResearch(runId);
    });
    back("/crm/accounts", { notice: `Research queued for ${runIds.length} accounts` });
  } else if (op === "drive") {
    after(async () => {
      for (const id of ids) await ensureAccountFolders(id).catch((e) => console.warn(errMsg(e)));
    });
  }
  back("/crm/accounts", { notice: `Updated ${ids.length} accounts` });
}

export async function importCsv(form: FormData) {
  const session = await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back("/crm/accounts/import", { error: "Choose a CSV file" });
  if (file.size > 10 * 1024 * 1024) back("/crm/accounts/import", { error: "CSV must be under 10MB" });
  const { job } = await importCsvText(file.name, await file.text(), {
    createdById: session.sub,
    ownerId: session.sub,
    defaultTags: str(form, "tags").split(","),
    updateExisting: form.get("updateExisting") === "on",
  });
  back("/crm/accounts/import", { job: job.id });
}

// --- Contacts & activities ----------------------------------------------------------

export async function addContact(accountId: string, form: FormData) {
  await requireAdmin();
  const count = await db.contact.count({ where: { accountId } });
  await db.contact.create({
    data: {
      accountId,
      firstName: optStr(form, "firstName"),
      lastName: optStr(form, "lastName"),
      title: optStr(form, "title"),
      email: optStr(form, "email")?.toLowerCase() ?? null,
      phone: optStr(form, "phone"),
      linkedin: optStr(form, "linkedin"),
      isPrimary: count === 0,
    },
  });
  back(`/crm/accounts/${accountId}`);
}

export async function deleteContact(accountId: string, contactId: string) {
  await requireAdmin();
  await db.contact.delete({ where: { id: contactId } });
  back(`/crm/accounts/${accountId}`);
}

export async function logActivity(accountId: string, form: FormData) {
  const session = await requireAdmin();
  const type = str(form, "type") || "NOTE";
  const direction = str(form, "direction");
  const due = optStr(form, "dueAt");
  await recordActivity({
    accountId,
    contactId: optStr(form, "contactId"),
    type,
    direction: direction === "OUTBOUND" || direction === "INBOUND" ? direction : null,
    subject: optStr(form, "subject"),
    body: optStr(form, "body"),
    dueAt: type === "TASK" ? (due ? new Date(due) : addDays(new Date(), 1)) : null,
    createdById: session.sub,
  });
  back(`/crm/accounts/${accountId}`);
}

export async function completeTask(activityId: string, redirectTo: string) {
  await requireAdmin();
  await db.activity.update({ where: { id: activityId }, data: { completedAt: new Date() } });
  back(redirectTo);
}

export async function sendEmail(accountId: string, form: FormData) {
  const session = await requireAdmin();
  try {
    await sendTrackedEmail({ accountId, contactId: str(form, "contactId"), subject: str(form, "subject"), body: str(form, "body"), userId: session.sub });
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: `Email not sent: ${errMsg(err)}` });
  }
  back(`/crm/accounts/${accountId}`, { notice: "Email sent and tracking" });
}

export async function draftEmail(accountId: string, form: FormData) {
  await requireAdmin();
  const prompt = await db.savedPrompt.findUnique({ where: { id: str(form, "promptId") } });
  const account = await db.account.findUniqueOrThrow({
    where: { id: accountId },
    include: { contacts: true, research: { where: { kind: "RESEARCH", status: "DONE" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!prompt) back(`/crm/accounts/${accountId}`, { error: "Choose an outreach prompt" });
  const contactId = str(form, "contactId");
  const contact = account.contacts.find((c) => c.id === contactId);
  const demoExtension = await demoExtensionForAccount(accountId);
  const demo = await demoLineConfig();
  const vars = {
    ...accountVariables({ ...account, contacts: contact ? [contact] : account.contacts }),
    my_company: await companyName(),
    demo_phone: demoExtension && demo.number ? formatPhone(demo.number) : "",
    demo_extension: demoExtension ?? "",
  };
  try {
    const draft = await draftOutreachEmail(renderPrompt(prompt.template, vars), account.research[0]?.output ?? "");
    const run = await db.researchRun.create({
      data: { kind: "OUTREACH", accountId, promptId: prompt.id, input: contactId, output: draft.body, resultJson: JSON.stringify(draft), status: "DONE", finishedAt: new Date() },
    });
    back(`/crm/accounts/${accountId}`, { draft: run.id });
  } catch (err) {
    unstable_rethrow(err);
    back(`/crm/accounts/${accountId}`, { error: `Draft failed: ${errMsg(err)}` });
  }
}

export async function syncOutreachNow() {
  await requireAdmin();
  try {
    const r = await syncGmail();
    for (const id of r.accountsTouched) await writeOutreachLog(id).catch(() => undefined);
    back("/crm/outreach", { notice: `Gmail synced: ${r.recorded} new touches from ${r.scanned} messages` });
  } catch (err) {
    unstable_rethrow(err);
    back("/crm/outreach", { error: errMsg(err) });
  }
}

export async function exportOutreachLog(accountId: string) {
  await requireAdmin();
  try {
    await writeOutreachLog(accountId);
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: errMsg(err) });
  }
  back(`/crm/accounts/${accountId}`, { notice: "Outreach log written to Drive" });
}

// --- Drive -------------------------------------------------------------------------

export async function createDriveFolders(accountId: string) {
  await requireAdmin();
  try {
    await ensureAccountFolders(accountId);
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: `Drive: ${errMsg(err)}` });
  }
  back(`/crm/accounts/${accountId}`, { notice: "Drive folders ready" });
}

// --- Claude research & prospecting ------------------------------------------------

export async function runResearch(accountId: string, form: FormData) {
  await requireAdmin();
  let runId: string;
  try {
    runId = await startAccountResearch(accountId, optStr(form, "promptId"), optStr(form, "customPrompt") ?? undefined);
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: errMsg(err) });
  }
  after(() => executeAccountResearch(runId));
  back(`/crm/research/${runId}`);
}

export async function applyResearch(runId: string) {
  await requireAdmin();
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId } });
  const summary = safeJson<ResearchSummary | null>(run.resultJson, null);
  if (run.accountId && summary) await applyResearchSummary(run.accountId, summary, true);
  back(`/crm/research/${runId}`, { notice: "Account updated from research" });
}

export async function saveRunToDrive(runId: string) {
  await requireAdmin();
  try {
    const f = await archiveRunToDrive(runId);
    if (!f) back(`/crm/research/${runId}`, { error: "Connect Google in Settings first" });
  } catch (err) {
    unstable_rethrow(err);
    back(`/crm/research/${runId}`, { error: errMsg(err) });
  }
  back(`/crm/research/${runId}`, { notice: "Saved to Drive" });
}

export async function runProspecting(form: FormData) {
  await requireAdmin();
  const count = Math.min(50, Math.max(1, optInt(form, "count") ?? 10));
  const runId = await startProspecting(optStr(form, "promptId"), str(form, "criteria"), count, optStr(form, "customPrompt") ?? undefined);
  after(() => executeProspecting(runId));
  back(`/crm/prospecting/${runId}`);
}

export async function addProspects(runId: string, form: FormData) {
  const session = await requireAdmin();
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId } });
  const { prospects = [] } = safeJson<{ prospects?: Prospect[] }>(run.resultJson, {});
  const picked = form.getAll("pick").map((v) => prospects[Number(v)]).filter((p): p is Prospect => Boolean(p));
  const tags = str(form, "tags").split(",");
  const result = await importRows(
    picked.map((p, i) => {
      const domain = normalizeDomain(p.website);
      const [firstName, ...rest] = (p.contactName ?? "").split(/\s+/);
      return {
        rowNumber: i + 1,
        account: {
          name: p.name,
          domain,
          website: websiteUrl(p.website),
          phone: p.phone,
          industry: p.industry,
          city: p.city,
          state: p.state,
          employees: p.employees,
          stage: null,
          tags: ["claude-prospect"],
          notes: `Why fit: ${p.whyFit}${p.sourceUrl ? `\nSource: ${p.sourceUrl}` : ""}`,
          avgJobValueCents: null,
        },
        contact: p.contactName || p.contactEmail ? { firstName: firstName || null, lastName: rest.join(" ") || null, title: p.contactTitle, email: p.contactEmail?.toLowerCase() ?? null, phone: null, linkedin: null } : null,
      };
    }),
    { source: "claude", ownerId: session.sub, defaultTags: tags, updateExisting: false },
  );
  // Carry Claude's fit score over to new accounts.
  for (const p of picked) {
    const domain = normalizeDomain(p.website);
    if (domain) await db.account.updateMany({ where: { domain, fitScore: null }, data: { fitScore: p.fitScore } });
  }
  if (form.get("research") === "on") {
    const promptId = (await db.savedPrompt.findFirst({ where: { kind: "RESEARCH", isDefault: true } }))?.id;
    const accounts = await db.account.findMany({ where: { domain: { in: picked.map((p) => normalizeDomain(p.website)).filter((d): d is string => Boolean(d)) } } });
    if (promptId) {
      const ids: string[] = [];
      for (const a of accounts) ids.push(await startAccountResearch(a.id, promptId));
      after(async () => {
        for (const id of ids) await executeAccountResearch(id);
      });
    }
  }
  back(`/crm/prospecting/${runId}`, { notice: `Added ${result.created} new accounts (${result.skipped} already in CRM)` });
}

// --- Saved prompts -----------------------------------------------------------------

export async function savePrompt(form: FormData) {
  const session = await requireAdmin();
  const id = optStr(form, "id");
  const kind = str(form, "kind");
  const data = {
    name: str(form, "name") || "Untitled prompt",
    kind: ["RESEARCH", "PROSPECTING", "OUTREACH"].includes(kind) ? kind : "RESEARCH",
    description: str(form, "description"),
    template: str(form, "template"),
    isDefault: form.get("isDefault") === "on",
  };
  if (data.isDefault) await db.savedPrompt.updateMany({ where: { kind: data.kind }, data: { isDefault: false } });
  if (id) await db.savedPrompt.update({ where: { id }, data });
  else await db.savedPrompt.create({ data: { ...data, createdById: session.sub } });
  back("/crm/prompts", { notice: "Prompt saved" });
}

export async function deletePrompt(id: string) {
  await requireAdmin();
  await db.savedPrompt.delete({ where: { id } });
  back("/crm/prompts");
}

// --- Receptionists & knowledge base ------------------------------------------------

export async function createReceptionist(accountId: string, form: FormData) {
  await requireAdmin();
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const r = await db.receptionist.create({
    data: {
      accountId,
      name: str(form, "name") || "Receptionist",
      businessName: str(form, "businessName") || account.name,
      ragToken: randomBytes(24).toString("base64url"),
      demoExtension: form.get("demo") === "on" ? await freeExtension() : null,
    },
  });
  back(`/crm/receptionists/${r.id}`);
}

export async function updateReceptionist(id: string, form: FormData) {
  await requireAdmin();
  const ext = cleanDigits(str(form, "demoExtension"));
  if (ext) {
    const taken = await db.receptionist.findFirst({ where: { demoExtension: ext, id: { not: id } } });
    if (taken) back(`/crm/receptionists/${id}`, { error: `Extension ${ext} is already used by ${taken.businessName}` });
    if (ext.length < 2 || ext.length > 6) back(`/crm/receptionists/${id}`, { error: "Extensions are 2–6 digits" });
  }
  await db.receptionist.update({
    where: { id },
    data: {
      name: str(form, "name"),
      businessName: str(form, "businessName"),
      greeting: str(form, "greeting"),
      persona: str(form, "persona"),
      voiceId: optStr(form, "voiceId"),
      language: str(form, "language") || "en",
      timezone: str(form, "timezone") || "America/New_York",
      businessHours: str(form, "businessHours"),
      escalationPhone: optStr(form, "escalationPhone"),
      escalationRules: str(form, "escalationRules"),
      bookingUrl: optStr(form, "bookingUrl"),
      extraInstructions: str(form, "extraInstructions"),
      elevenLabsAgentId: optStr(form, "elevenLabsAgentId"),
      demoExtension: ext || null,
    },
  });
  await markDirty(id);
  back(`/crm/receptionists/${id}`, { notice: "Saved" });
}

export async function markReviewed(accountId: string) {
  await requireAdmin();
  await db.account.update({ where: { id: accountId }, data: { needsReview: false } });
  revalidatePath("/crm", "layout");
  back(`/crm/accounts/${accountId}`, { notice: "Marked as reviewed" });
}

export async function updateBooking(id: string, form: FormData) {
  await requireAdmin();
  const path = `/crm/receptionists/${id}`;
  const hours = str(form, "bookingHours") || "Mon-Fri 09:00-17:00";
  try {
    if (!Object.keys(parseWeeklyHours(hours)).length) throw new Error("Add at least one line of bookable hours");
  } catch (err) {
    back(path, { error: `Bookable hours: ${errMsg(err)}` });
  }
  const int = (key: string, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, optInt(form, key) ?? fallback));
  await db.receptionist.update({
    where: { id },
    data: {
      bookingEnabled: form.get("bookingEnabled") === "on",
      bookingCalendarId: str(form, "bookingCalendarId") || "primary",
      bookingTitle: str(form, "bookingTitle") || "Discovery call",
      bookingHours: hours,
      bookingSlotMinutes: int("bookingSlotMinutes", 10, 240, 30),
      bookingMinNoticeHours: int("bookingMinNoticeHours", 0, 336, 2),
      bookingDaysAhead: int("bookingDaysAhead", 1, 60, 14),
      bookingBufferMinutes: int("bookingBufferMinutes", 0, 120, 0),
      bookingMeetingType: ["google_meet", "caller_choice"].includes(str(form, "bookingMeetingType")) ? str(form, "bookingMeetingType") : "phone",
      bookingQuestions: str(form, "bookingQuestions"),
      bookingHolidays: str(form, "bookingHolidays") === "CA-BC" ? "CA-BC" : "",
      bookingClosedDates: str(form, "bookingClosedDates"),
      bookingAddsToCrm: form.get("bookingAddsToCrm") === "on",
    },
  });
  await markDirty(id);
  back(path, { notice: "Booking settings saved. Sync to ElevenLabs to update the live agent." });
}

/** Run the same lookup the agent's get_available_times tool does, so you can sanity-check it. */
export async function previewOpenings(id: string) {
  await requireAdmin();
  const path = `/crm/receptionists/${id}`;
  try {
    const r = await db.receptionist.findUniqueOrThrow({ where: { id } });
    const res = await availability({ ...r, bookingEnabled: true }, {});
    const list = "slots" in res && res.slots?.length ? res.slots.map((s) => s.label).join(" · ") : res.message;
    back(path, { notice: `Openings the agent would offer: ${list}` });
  } catch (err) {
    unstable_rethrow(err);
    back(path, { error: errMsg(err) });
  }
}

export async function syncToElevenLabs(id: string) {
  await requireAdmin();
  try {
    const r = await syncReceptionist(id);
    back(`/crm/receptionists/${id}`, { notice: `Synced to ElevenLabs agent ${r.agentId} (${r.docs} KB documents)` });
  } catch (err) {
    unstable_rethrow(err);
    back(`/crm/receptionists/${id}`, { error: errMsg(err) });
  }
}

export async function draftKbFromWebsite(id: string) {
  await requireAdmin();
  let runId: string;
  try {
    runId = await startKbDraft(id);
  } catch (err) {
    back(`/crm/receptionists/${id}`, { error: errMsg(err) });
  }
  after(() => executeKbDraft(runId));
  back(`/crm/receptionists/${id}`, { notice: "Claude is reading the website — drafts will appear below as inactive items for review", kbRun: runId });
}

export async function rotateRagToken(id: string) {
  await requireAdmin();
  await db.receptionist.update({ where: { id }, data: { ragToken: randomBytes(24).toString("base64url") } });
  back(`/crm/receptionists/${id}`, { notice: "RAG token rotated — update the ElevenLabs tool header" });
}

// --- Billing -----------------------------------------------------------------------

export async function savePlan(form: FormData) {
  await requireAdmin();
  const id = optStr(form, "id");
  const data = {
    name: str(form, "name"),
    priceCents: parseMoneyToCents(str(form, "price")) ?? 0,
    setupFeeCents: parseMoneyToCents(str(form, "setupFee")) ?? 0,
    includedMinutes: optInt(form, "includedMinutes") ?? 0,
    features: str(form, "features"),
    stripePriceId: optStr(form, "stripePriceId"),
  };
  if (id) await db.plan.update({ where: { id }, data });
  else await db.plan.create({ data });
  back("/crm/billing", { notice: "Plan saved" });
}

export async function saveManualBilling(accountId: string, form: FormData) {
  await requireAdmin();
  const planId = optStr(form, "planId");
  const plan = planId ? await db.plan.findUnique({ where: { id: planId } }) : null;
  const mrr = parseMoneyToCents(optStr(form, "mrr")) ?? plan?.priceCents ?? 0;
  await setManualSubscription(accountId, planId, mrr, str(form, "status") || "ACTIVE");
  back(`/crm/accounts/${accountId}`, { notice: "Billing updated" });
}

export async function checkoutLink(accountId: string, form: FormData) {
  await requireAdmin();
  let url: string;
  try {
    url = await createCheckout(accountId, str(form, "planId"), "/portal/billing");
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: errMsg(err) });
  }
  await recordActivity({ accountId, type: "BILLING", source: "system", subject: "Stripe checkout link created", body: url });
  back(`/crm/accounts/${accountId}`, { notice: "Checkout link created — copy it from the activity feed", checkout: url });
}

// --- Portal users ------------------------------------------------------------------

export async function inviteClientUser(accountId: string, form: FormData) {
  await requireAdmin();
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!email || password.length < 8) back(`/crm/accounts/${accountId}`, { error: "Email and an 8+ character password are required" });
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) back(`/crm/accounts/${accountId}`, { error: "A user with that email already exists" });
  await db.user.create({ data: { email, name: optStr(form, "name"), passwordHash: await hashPassword(password), role: "CLIENT", accountId } });
  back(`/crm/accounts/${accountId}`, { notice: `Portal access created for ${email}` });
}

// --- Settings ---------------------------------------------------------------------

export async function saveGoal(form: FormData) {
  await requireAdmin();
  const min = Math.max(1, optInt(form, "min") ?? 30);
  const max = Math.max(min, optInt(form, "max") ?? 50);
  const { setSetting } = await import("@/lib/settings");
  await setSetting("goal.clients", JSON.stringify({ min, max, targetDate: optStr(form, "targetDate") ?? undefined }));
  back("/crm/settings", { notice: "Goal saved" });
}

export async function seedDefaultPrompts() {
  const session = await requireAdmin();
  const { DEFAULT_PROMPTS } = await import("@/lib/prompts");
  let n = 0;
  for (const p of DEFAULT_PROMPTS) {
    const exists = await db.savedPrompt.findFirst({ where: { name: p.name } });
    if (exists) continue;
    await db.savedPrompt.create({ data: { ...p, isDefault: p.isDefault ?? false, createdById: session.sub } });
    n++;
  }
  back("/crm/settings", { notice: `Added ${n} starter prompts` });
}

export async function saveCompanyName(form: FormData) {
  await requireAdmin();
  const name = str(form, "companyName").trim();
  if (!name) back("/crm/settings", { error: "Company name can't be empty" });
  const changed = await renameCompany(name, form.get("rewrite") === "on");
  revalidatePath("/", "layout");
  back("/crm/settings", { notice: `Company name set to ${name}${changed ? ` · updated ${changed} records — sync your receptionist to push the new name to ElevenLabs` : ""}` });
}

export async function changePassword(form: FormData) {
  const session = await requireAdmin();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.sub } });
  const bcrypt = (await import("bcryptjs")).default;
  if (!(await bcrypt.compare(str(form, "current"), user.passwordHash))) back("/crm/settings", { error: "Current password is incorrect" });
  const next = str(form, "next");
  if (next.length < 10) back("/crm/settings", { error: "New password must be at least 10 characters" });
  if (next !== str(form, "confirm")) back("/crm/settings", { error: "New passwords don't match" });
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  back("/crm/settings", { notice: "Password changed" });
}

export async function disconnectGoogle() {
  await requireAdmin();
  const { deleteSetting } = await import("@/lib/settings");
  await deleteSetting("google.refresh_token");
  back("/crm/settings", { notice: "Google disconnected" });
}

// --- Demo line ---------------------------------------------------------------------

async function freeExtension(): Promise<string> {
  const taken = await db.receptionist.findMany({ where: { demoExtension: { not: null } }, select: { demoExtension: true } });
  return nextFreeExtension(taken.map((t) => t.demoExtension));
}

export async function assignDemoExtension(receptionistId: string) {
  await requireAdmin();
  await db.receptionist.update({ where: { id: receptionistId }, data: { demoExtension: await freeExtension() } });
  back("/crm/demo-line", { notice: "Extension assigned" });
}

export async function clearDemoExtension(receptionistId: string) {
  await requireAdmin();
  await db.receptionist.update({ where: { id: receptionistId }, data: { demoExtension: null } });
  back("/crm/demo-line", { notice: "Removed from the demo directory" });
}

export async function saveDemoLineSettings(form: FormData) {
  await requireAdmin();
  const { setSetting, deleteSetting } = await import("@/lib/settings");
  const greeting = str(form, "greeting");
  if (greeting) await setSetting("demo.greeting", greeting);
  else await deleteSetting("demo.greeting");
  const fallback = str(form, "fallbackReceptionistId");
  if (fallback) await setSetting("demo.fallbackReceptionistId", fallback);
  else await deleteSetting("demo.fallbackReceptionistId");
  back("/crm/demo-line", { notice: "Demo line settings saved" });
}
