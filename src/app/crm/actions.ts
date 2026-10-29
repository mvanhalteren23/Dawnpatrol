"use server";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, issueSession, requireAdmin, requireStaff } from "@/lib/auth";
import type { SessionPayload } from "@/lib/session";
import { canTouch, findDuplicateAccount, OwnershipError, touchAccount } from "@/lib/team";
import { STAGES, isClientStage, type Stage } from "@/lib/constants";
import { googleConnection } from "@/lib/google";
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
  researchNewAccounts,
  startKbDraft,
  startProspecting,
} from "@/lib/jobs";
import { draftOutreachEmail, proposeStyleGuide, type Prospect, type ResearchSummary } from "@/lib/ai";
import { STYLE_GUIDE_KEY, STYLE_PROPOSAL_KEY, styleLearningMaterial, writerGuidance } from "@/lib/email-writer";
import { accountVariables, renderPrompt } from "@/lib/prompts";
import { companyName, renameCompany } from "@/lib/brand";
import { createCheckout, setManualSubscription } from "@/lib/billing";
import { markDirty, syncReceptionist } from "@/lib/elevenlabs";
import { availability } from "@/lib/agent-booking";
import { provisionLine, removeLine } from "@/lib/business-line";
import { availabilityFromForm, followUpFromForm } from "@/lib/booking";
import { cleanDigits, dialableNumber, nextFreeExtension, ringFromForm } from "@/lib/twilio";
import { demoExtensionForAccount, demoLineConfig, formatPhone } from "@/lib/demo-line";
import { forwardingLoop, LOOP_MESSAGE, type KeepMethod } from "@/lib/keep-number";
import { DEFAULT_CALL_HOURS } from "@/lib/followup-rules";
import { newLeadFormKey } from "@/lib/followup";
import { parseWeeklyHours } from "@/lib/booking";
import { leadAlertFromForm } from "@/lib/follow-up-rules";

function back(path: string, params?: Record<string, string>): never {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  revalidatePath(path);
  redirect(`${path}${qs}`);
}

function errMsg(err: unknown) {
  return (err as Error)?.message ?? String(err);
}

/**
 * Before working an account: a rep may only work accounts they own or unassigned ones (which
 * become theirs). Otherwise sends them back to the account with who owns it.
 */
async function guard(session: SessionPayload, accountId: string, path = `/crm/accounts/${accountId}`): Promise<void> {
  try {
    await touchAccount(session, accountId);
  } catch (err) {
    if (err instanceof OwnershipError) back(path, { error: err.message });
    throw err;
  }
}

/** Receptionist settings: admins any; reps their own prospects' demo receptionists (see canAccessReceptionist). */
async function requireReceptionist(id: string): Promise<SessionPayload> {
  const session = await requireStaff();
  const { canAccessReceptionist } = await import("@/lib/access");
  if (!(await canAccessReceptionist(session, id))) back("/crm", { error: "Only an administrator can change this receptionist (it belongs to a client or another rep's account)" });
  return session;
}

/** Same check for actions that return a result instead of redirecting. */
async function guardResult(session: SessionPayload, accountId: string): Promise<string | null> {
  try {
    await touchAccount(session, accountId);
    return null;
  } catch (err) {
    if (err instanceof OwnershipError) return err.message;
    throw err;
  }
}

// --- Accounts -----------------------------------------------------------------

export async function createAccount(form: FormData) {
  const session = await requireStaff();
  const website = optStr(form, "website");
  const domain = normalizeDomain(website);
  const dup = await findDuplicateAccount({ domain, phone: optStr(form, "phone"), name: str(form, "name"), city: optStr(form, "city") });
  if (dup) back(`/crm/accounts/${dup.id}`, { error: `Not added: ${dup.name} is already in the CRM (${dup.reason}), owned by ${dup.owner}.` });
  const ownerId = await ownerFromForm(session, form);
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
      ownerId,
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
  await researchNewAccounts([account.id]);
  back(`/crm/accounts/${account.id}`);
}

export async function updateAccount(accountId: string, form: FormData) {
  const session = await requireStaff();
  await guard(session, accountId);
  const website = optStr(form, "website");
  const domain = normalizeDomain(website);
  const avg = parseMoneyToCents(optStr(form, "avgJobValue"));
  const dup = await findDuplicateAccount({ domain, phone: optStr(form, "phone"), name: str(form, "name"), city: optStr(form, "city") }, accountId);
  if (dup) back(`/crm/accounts/${accountId}`, { error: `Not saved: ${dup.name} already has that ${dup.reason.replace("same ", "")} (owned by ${dup.owner}).`, edit: "1" });
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
    back(`/crm/accounts/${accountId}`, { error: `Could not save: ${errMsg(err)}`, edit: "1" });
  }
  const stage = str(form, "stage");
  if ((STAGES as readonly string[]).includes(stage)) await changeStage(accountId, stage as Stage, session.sub);
  back(`/crm/accounts/${accountId}`, { notice: "Saved" });
}

/**
 * Owner for a new account: admins pick anyone on the team (or nobody); reps always own what they add.
 */
async function ownerFromForm(session: SessionPayload, form: FormData): Promise<string | null> {
  if (session.role !== "ADMIN" || !form.has("ownerId")) return session.sub;
  const id = str(form, "ownerId");
  if (!id) return null;
  const user = await db.user.findFirst({ where: { id, role: { in: ["ADMIN", "REP"] }, disabled: false }, select: { id: true } });
  return user?.id ?? session.sub;
}

/**
 * Account owner dropdown. Admins assign any rep (or unassign). Reps can take an unassigned
 * account or hand their own back; they can't take another rep's.
 */
export async function setAccountOwner(accountId: string, form: FormData) {
  const session = await requireStaff();
  const ownerId = str(form, "ownerId") || null;
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { ownerId: true } });
  if (account.ownerId === ownerId) back(`/crm/accounts/${accountId}`);
  if (session.role !== "ADMIN") {
    const allowed = (ownerId === session.sub && !account.ownerId) || (ownerId === null && account.ownerId === session.sub);
    if (!allowed) back(`/crm/accounts/${accountId}`, { error: "Only an administrator can move an account between reps" });
  }
  const owner = ownerId ? await db.user.findFirst({ where: { id: ownerId, role: { in: ["ADMIN", "REP"] }, disabled: false }, select: { id: true, name: true, email: true } }) : null;
  if (ownerId && !owner) back(`/crm/accounts/${accountId}`, { error: "Pick an active team member" });
  await db.account.update({ where: { id: accountId }, data: { ownerId } });
  // Open tasks follow the account to its new owner's queue (tasks are shown by account owner).
  await recordActivity({ accountId, type: "NOTE", source: "system", subject: "Owner changed", body: owner ? `Assigned to ${owner.name || owner.email}.` : "Unassigned.", createdById: session.sub });
  revalidatePath("/crm/accounts");
  back(`/crm/accounts/${accountId}`, { notice: owner ? `Assigned to ${owner.name || owner.email}` : "Account unassigned" });
}

export async function setStage(accountId: string, stage: string) {
  const session = await requireStaff();
  if (!(STAGES as readonly string[]).includes(stage)) return;
  if (await guardResult(session, accountId)) return;
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
  const session = await requireStaff();
  const picked = form.getAll("ids").map(String).filter(Boolean);
  const op = str(form, "op");
  if (!picked.length) back("/crm/accounts", { error: "Select at least one account" });
  if ((op === "delete" || op.startsWith("owner:")) && session.role !== "ADMIN") back("/crm/accounts", { error: "Only an administrator can do that" });
  // Reps only act on their own and unassigned accounts.
  const ids = session.role === "ADMIN" ? picked : (await db.account.findMany({ where: { id: { in: picked }, OR: [{ ownerId: session.sub }, { ownerId: null }] }, select: { id: true } })).map((a) => a.id);
  if (!ids.length) back("/crm/accounts", { error: "Those accounts belong to other reps" });
  if (op.startsWith("owner:")) {
    const ownerId = op.slice(6) || null;
    if (ownerId && !(await db.user.findFirst({ where: { id: ownerId, role: { in: ["ADMIN", "REP"] }, disabled: false } }))) back("/crm/accounts", { error: "Pick an active team member" });
    await db.account.updateMany({ where: { id: { in: ids } }, data: { ownerId } });
  } else if (op === "delete") {
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
  const session = await requireStaff();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back("/crm/accounts/import", { error: "Choose a CSV file" });
  if (file.size > 10 * 1024 * 1024) back("/crm/accounts/import", { error: "CSV must be under 10MB" });
  const { job, createdIds } = await importCsvText(file.name, await file.text(), {
    createdById: session.sub,
    ownerId: session.sub,
    canUpdate: (ownerId) => canTouch(session, ownerId),
    defaultTags: str(form, "tags").split(","),
    updateExisting: form.get("updateExisting") === "on",
  });
  const researching = await researchNewAccounts(createdIds);
  back("/crm/accounts/import", { job: job.id, ...(researching ? { notice: `Researching ${researching} of ${createdIds.length} new accounts automatically${createdIds.length > researching ? " (the rest: select them on Accounts and run research in bulk)" : ""}` } : {}) });
}

// --- Contacts & activities ----------------------------------------------------------

export async function addContact(accountId: string, form: FormData) {
  await guard(await requireStaff(), accountId);
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
  await guard(await requireStaff(), accountId);
  await db.contact.delete({ where: { id: contactId, accountId } });
  back(`/crm/accounts/${accountId}`);
}

export async function logActivity(accountId: string, form: FormData) {
  const session = await requireStaff();
  await guard(session, accountId);
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

export async function setupDialerAction() {
  await requireAdmin();
  try {
    const { setupDialer } = await import("@/lib/dialer");
    await setupDialer();
  } catch (err) {
    unstable_rethrow(err);
    back("/crm/settings", { error: `Dialer setup failed: ${errMsg(err)}` });
  }
  back("/crm/settings", { notice: "Dialer is set up. Open Dialer in the menu to start calling." });
}

const CALL_OUTCOMES: Record<string, string> = {
  connected: "Connected",
  booked: "Booked a meeting",
  call_back: "Asked to call back",
  voicemail: "Left voicemail",
  no_answer: "No answer",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

const NEXT_STEPS: Record<string, string> = {
  call: "Call again",
  email: "Send follow-up email",
  demo: "Send demo line + extension",
  prep: "Prepare demo receptionist for the meeting",
};

/**
 * Dialer wrap-up: log the outcome and note on the call, queue next-step tasks, and move the
 * account (booked → meeting/Demo stage, not interested → Lost when ticked, wrong number → review).
 * Returns a plain result so the dialer can move on to the next prospect without a page reload.
 */
export async function saveCallOutcome(form: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requireStaff();
  const accountId = str(form, "accountId");
  const callSid = str(form, "callSid");
  const outcome = str(form, "outcome");
  if (!accountId || !CALL_OUTCOMES[outcome]) return { ok: false, error: "Pick an outcome" };
  const notYours = await guardResult(session, accountId);
  if (notYours) return { ok: false, error: notYours };
  const { ensureCallActivity } = await import("@/lib/dialer");
  const contactId = optStr(form, "contactId");
  const note = str(form, "note").trim();

  const call = callSid
    ? await ensureCallActivity({ callSid, accountId, contactId, userId: session.sub })
    : await recordActivity({ accountId, contactId, type: "CALL", direction: "OUTBOUND", subject: "Call", source: "dialer", createdById: session.sub });
  if (call) {
    const fresh = await db.activity.findUniqueOrThrow({ where: { id: call.id } });
    await db.activity.update({
      where: { id: call.id },
      data: { outcome, subject: `Call — ${CALL_OUTCOMES[outcome]}`, body: note ? [note, fresh.body].filter(Boolean).join("\n\n") : fresh.body },
    });
  }

  // Next steps -> tasks; the earliest becomes the account's next follow-up.
  const dues: Date[] = [];
  for (const key of form.getAll("next").map(String)) {
    if (!NEXT_STEPS[key]) continue;
    const days = Math.min(60, Math.max(0, Number(str(form, `days_${key}`) || (key === "call" ? 2 : 1))));
    const due = addDays(new Date(), days);
    dues.push(due);
    await recordActivity({ accountId, contactId, type: "TASK", subject: NEXT_STEPS[key], body: note || null, dueAt: due, source: "dialer", createdById: session.sub });
  }
  const custom = str(form, "customTask").trim();
  if (custom) {
    const due = optStr(form, "customDue") ? new Date(str(form, "customDue")) : addDays(new Date(), 1);
    dues.push(due);
    await recordActivity({ accountId, contactId, type: "TASK", subject: custom, dueAt: due, source: "dialer", createdById: session.sub });
  }
  if (dues.length) await db.account.update({ where: { id: accountId }, data: { nextFollowUpAt: new Date(Math.min(...dues.map((d) => d.getTime()))) } });

  if (outcome === "booked") {
    await recordActivity({ accountId, contactId, type: "MEETING", direction: "OUTBOUND", subject: "Meeting booked by phone", body: note || null, source: "dialer", createdById: session.sub });
  }
  if (outcome === "not_interested" && form.get("markLost") === "on") await changeStage(accountId, "LOST", session.sub);
  if (outcome === "wrong_number") {
    await db.account.update({ where: { id: accountId }, data: { needsReview: true, reviewReason: "Dialer: the number called was wrong. Update the phone number." } });
  }
  revalidatePath(`/crm/accounts/${accountId}`);
  return { ok: true };
}

// --- Dialer voicemails -------------------------------------------------------------

export async function saveVoicemailSettings(form: FormData) {
  await requireAdmin();
  const { setSetting } = await import("@/lib/settings");
  const { VM_KEYS } = await import("@/lib/voicemail");
  await setSetting(VM_KEYS.prompt, str(form, "prompt").trim());
  await setSetting(VM_KEYS.voiceId, str(form, "voiceId").trim());
  await setSetting(VM_KEYS.callback, str(form, "callback").trim());
  await setSetting(VM_KEYS.consent, form.get("consent") === "on" ? "yes" : "no");
  back("/crm/dialer", { notice: "Voicemail settings saved", vm: "1" });
}

export async function uploadVoicemail(form: FormData) {
  await requireStaff();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) back("/crm/dialer", { error: "Choose an MP3 or WAV file", vm: "1" });
  if (file.size > 5 * 1024 * 1024) back("/crm/dialer", { error: "Voicemail files must be under 5 MB", vm: "1" });
  const mime = file.type === "audio/wav" || file.type === "audio/x-wav" || file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  if (!/\.(mp3|wav)$/i.test(file.name) && !/audio\/(mpeg|mp3|wav|x-wav)/.test(file.type)) back("/crm/dialer", { error: "Twilio can only play MP3 or WAV files", vm: "1" });
  const saved = await db.voicemailAudio.create({ data: { kind: "upload", name: str(form, "name") || file.name, mimeType: mime, data: new Uint8Array(await file.arrayBuffer()) } });
  const { getSetting, setSetting } = await import("@/lib/settings");
  const { VM_KEYS } = await import("@/lib/voicemail");
  if (!(await getSetting(VM_KEYS.defaultId))) await setSetting(VM_KEYS.defaultId, saved.id);
  back("/crm/dialer", { notice: "Voicemail uploaded", vm: "1" });
}

export async function setDefaultVoicemail(id: string) {
  await requireAdmin();
  const { setSetting } = await import("@/lib/settings");
  const { VM_KEYS } = await import("@/lib/voicemail");
  await setSetting(VM_KEYS.defaultId, id);
  back("/crm/dialer", { notice: "Default voicemail set", vm: "1" });
}

export async function deleteVoicemail(id: string) {
  await requireAdmin();
  await db.voicemailAudio.deleteMany({ where: { id, kind: { in: ["recorded", "upload"] } } });
  back("/crm/dialer", { notice: "Voicemail deleted", vm: "1" });
}

/** Pre-generate an account's AI voicemail (at auto-dial session start, or while it rings), so it's ready at the beep. */
export async function prepareVoicemail(accountId: string): Promise<{ ok: boolean; script?: string; voiced?: boolean; voiceError?: string; error?: string }> {
  const session = await requireStaff();
  const owner = await db.account.findUnique({ where: { id: accountId }, select: { ownerId: true } });
  if (!owner || !canTouch(session, owner.ownerId)) return { ok: false, error: "Another rep owns this account" };
  try {
    const { aiVoicemail } = await import("@/lib/voicemail");
    const vm = await aiVoicemail(accountId);
    return { ok: true, script: vm.script, voiced: Boolean(vm.id), voiceError: vm.voiceError };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Quick note on an account, any time (shows in Notes and the timeline). */
export async function addNote(accountId: string, form: FormData) {
  const session = await requireStaff();
  await guard(session, accountId);
  const body = str(form, "body").trim();
  if (!body) back(`/crm/accounts/${accountId}`, { error: "Write a note first" });
  await recordActivity({ accountId, type: "NOTE", body, source: "manual", createdById: session.sub, contactId: optStr(form, "contactId") });
  back(`/crm/accounts/${accountId}`, { notice: "Note added" });
}

export async function completeTask(activityId: string, redirectTo: string) {
  const session = await requireStaff();
  const task = await db.activity.findUniqueOrThrow({ where: { id: activityId }, select: { accountId: true } });
  await guard(session, task.accountId, redirectTo.split("?")[0]);
  await db.activity.update({ where: { id: activityId }, data: { completedAt: new Date() } });
  back(redirectTo);
}

export async function rateDraft(accountId: string, draftId: string, form: FormData) {
  await requireStaff();
  const rating = form.get("rating") ? Number(form.get("rating")) : null;
  await db.emailDraft.updateMany({ where: { id: draftId, accountId }, data: { rating: rating === 1 || rating === -1 ? rating : null, feedback: optStr(form, "feedback") } });
  back(`/crm/accounts/${accountId}`, { draft: draftId, notice: "Thanks: the email writer will use this on future drafts" });
}

export async function saveStyleGuide(form: FormData) {
  await requireAdmin();
  const { setSetting, deleteSetting } = await import("@/lib/settings");
  await setSetting(STYLE_GUIDE_KEY, str(form, "guide").trim());
  await deleteSetting(STYLE_PROPOSAL_KEY);
  back("/crm/outreach/writer", { notice: "Style guide saved: every new draft follows it" });
}

export async function proposeStyleGuideAction() {
  await requireAdmin();
  const { setSetting } = await import("@/lib/settings");
  try {
    const { guide, material, count } = await styleLearningMaterial();
    if (!count) back("/crm/outreach/writer", { error: "No feedback, edits or sent drafts to learn from yet" });
    const proposal = await proposeStyleGuide(guide, material);
    await setSetting(STYLE_PROPOSAL_KEY, JSON.stringify(proposal));
  } catch (err) {
    unstable_rethrow(err);
    back("/crm/outreach/writer", { error: `Couldn't propose an update: ${errMsg(err)}` });
  }
  back("/crm/outreach/writer", { notice: "Review the proposed update below, edit it if you like, then save" });
}

export async function discardStyleProposal() {
  await requireAdmin();
  const { deleteSetting } = await import("@/lib/settings");
  await deleteSetting(STYLE_PROPOSAL_KEY);
  back("/crm/outreach/writer");
}

export async function sendEmail(accountId: string, form: FormData) {
  const session = await requireStaff();
  await guard(session, accountId);
  try {
    const activity = await sendTrackedEmail({ accountId, contactId: str(form, "contactId"), subject: str(form, "subject"), body: str(form, "body"), userId: session.sub });
    // Remember what was actually sent for a draft: the writer learns from your edits and from replies.
    if (optStr(form, "draftId")) {
      await db.emailDraft.updateMany({ where: { id: str(form, "draftId"), accountId }, data: { sentSubject: str(form, "subject"), sentBody: str(form, "body"), sentActivityId: activity.id } });
    }
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: `Email not sent: ${errMsg(err)}` });
  }
  back(`/crm/accounts/${accountId}`, { notice: "Email sent and tracking" });
}

export async function draftEmail(accountId: string, form: FormData) {
  await guard(await requireStaff(), accountId);
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
  // One-off instructions, plus (on a redraft) what was wrong with the previous draft.
  const instructions = str(form, "instructions").trim();
  const previous = optStr(form, "previousDraftId") ? await db.emailDraft.findUnique({ where: { id: str(form, "previousDraftId") } }) : null;
  const feedback = str(form, "feedback").trim();
  if (previous && (feedback || form.get("rating"))) {
    await db.emailDraft.update({ where: { id: previous.id }, data: { feedback: feedback || previous.feedback, rating: form.get("rating") ? Number(form.get("rating")) : previous.rating } });
  }
  const oneOff = [
    instructions ? `Instructions for this email: ${instructions}` : "",
    previous ? `Rewrite this previous draft. ${feedback ? `Feedback on it: ${feedback}` : "Make it better."}\nPREVIOUS DRAFT:\nSubject: ${previous.subject}\n${previous.body}` : "",
  ].filter(Boolean).join("\n\n");
  try {
    const guidance = [await writerGuidance(prompt.id), oneOff].filter(Boolean).join("\n\n");
    const draft = await draftOutreachEmail(renderPrompt(prompt.template, vars), account.research[0]?.output ?? "", guidance);
    const saved = await db.emailDraft.create({
      data: { accountId, contactId: contactId || null, promptId: prompt.id, instructions: [instructions, previous && feedback ? `Redraft: ${feedback}` : ""].filter(Boolean).join(" · "), subject: draft.subject, body: draft.body },
    });
    back(`/crm/accounts/${accountId}`, { draft: saved.id });
  } catch (err) {
    unstable_rethrow(err);
    back(`/crm/accounts/${accountId}`, { error: `Draft failed: ${errMsg(err)}` });
  }
}

export async function syncOutreachNow() {
  await requireStaff();
  try {
    const r = await syncGmail();
    for (const id of r.accountsTouched) await writeOutreachLog(id).catch(() => undefined);
    back("/crm/outreach", {
      notice: `Gmail synced: ${r.recorded} new touches from ${r.scanned} messages`,
      ...(r.errors.length ? { error: `Some mailboxes couldn't be read: ${r.errors.join("; ")}` } : {}),
    });
  } catch (err) {
    unstable_rethrow(err);
    back("/crm/outreach", { error: errMsg(err) });
  }
}

export async function exportOutreachLog(accountId: string) {
  await requireStaff();
  try {
    await writeOutreachLog(accountId);
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: errMsg(err) });
  }
  back(`/crm/accounts/${accountId}`, { notice: "Outreach log written to Drive" });
}

// --- Drive -------------------------------------------------------------------------

export async function createDriveFolders(accountId: string) {
  await guard(await requireStaff(), accountId);
  try {
    await ensureAccountFolders(accountId);
  } catch (err) {
    back(`/crm/accounts/${accountId}`, { error: `Drive: ${errMsg(err)}` });
  }
  back(`/crm/accounts/${accountId}`, { notice: "Drive folders ready" });
}

// --- Claude research & prospecting ------------------------------------------------

export async function runResearch(accountId: string, form: FormData) {
  await guard(await requireStaff(), accountId);
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
  const session = await requireStaff();
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.accountId) await guard(session, run.accountId, `/crm/research/${runId}`);
  const summary = safeJson<ResearchSummary | null>(run.resultJson, null);
  if (run.accountId && summary) await applyResearchSummary(run.accountId, summary, true);
  back(`/crm/research/${runId}`, { notice: "Account updated from research" });
}

export async function saveRunToDrive(runId: string) {
  await requireStaff();
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
  await requireStaff();
  const count = Math.min(50, Math.max(1, optInt(form, "count") ?? 10));
  const runId = await startProspecting(optStr(form, "promptId"), str(form, "criteria"), count, optStr(form, "customPrompt") ?? undefined);
  after(() => executeProspecting(runId));
  back(`/crm/prospecting/${runId}`);
}

export async function addProspects(runId: string, form: FormData) {
  const session = await requireStaff();
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
    { source: "claude", ownerId: session.sub, defaultTags: tags, updateExisting: false, canUpdate: (ownerId) => canTouch(session, ownerId) },
  );
  // Carry Claude's fit score over to new accounts.
  for (const p of picked) {
    const domain = normalizeDomain(p.website);
    if (domain) await db.account.updateMany({ where: { domain, fitScore: null }, data: { fitScore: p.fitScore } });
  }
  // New accounts always get the fact-only profile; the checkbox adds the full opportunity audit.
  await researchNewAccounts(result.createdIds);
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
  const session = await requireStaff();
  const id = optStr(form, "id");
  const kind = str(form, "kind");
  const data = {
    name: str(form, "name") || "Untitled prompt",
    kind: ["RESEARCH", "PROSPECTING", "OUTREACH"].includes(kind) ? kind : "RESEARCH",
    description: str(form, "description"),
    template: str(form, "template"),
    // The default prompt is shared by the whole team: only admins choose it.
    isDefault: session.role === "ADMIN" && form.get("isDefault") === "on",
  };
  // Reps edit their own prompts; the team's shared ones are admin-managed.
  if (id && session.role !== "ADMIN") {
    const existing = await db.savedPrompt.findUnique({ where: { id }, select: { createdById: true } });
    if (existing?.createdById !== session.sub) back("/crm/prompts", { error: "Only an administrator can change a prompt someone else wrote. Duplicate it to make your own version." });
  }
  if (data.isDefault) await db.savedPrompt.updateMany({ where: { kind: data.kind }, data: { isDefault: false } });
  if (id) await db.savedPrompt.update({ where: { id }, data });
  else await db.savedPrompt.create({ data: { ...data, createdById: session.sub } });
  const returnTo = str(form, "returnTo");
  back(returnTo.startsWith("/crm/") ? returnTo : "/crm/prompts", { notice: "Prompt saved" });
}

export async function deletePrompt(id: string) {
  const session = await requireStaff();
  const existing = await db.savedPrompt.findUnique({ where: { id }, select: { createdById: true } });
  if (session.role !== "ADMIN" && existing?.createdById !== session.sub) back("/crm/prompts", { error: "Only an administrator can delete a prompt someone else wrote" });
  await db.savedPrompt.delete({ where: { id } });
  back("/crm/prompts");
}

// --- Receptionists & knowledge base ------------------------------------------------

export async function createReceptionist(accountId: string, form: FormData) {
  await requireAdmin();
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const followup = str(form, "agentType") === "followup";
  const r = await db.receptionist.create({
    data: {
      accountId,
      name: str(form, "name") || (followup ? "Ava" : "Receptionist"),
      businessName: str(form, "businessName") || account.name,
      ragToken: randomBytes(24).toString("base64url"),
      demoExtension: !followup && form.get("demo") === "on" ? await freeExtension() : null,
      ...(followup
        ? { agentType: "followup", leadFormKey: newLeadFormKey(), leadAlertOn: "leads", persona: "Warm, upbeat and to the point. Sounds like a helpful person from the office, never pushy." }
        : {}),
    },
  });
  back(`/crm/receptionists/${r.id}`, followup ? { notice: "Follow-up agent created. Fill in its goal, questions and rules, draft its knowledge from the website, sync it, then send a test lead." } : undefined);
}

/** The follow-up agent's goal, questions, rules, calling hours and retries (team only). */
export async function saveFollowupSettings(id: string, form: FormData) {
  await requireReceptionist(id);
  const path = `/crm/receptionists/${id}`;
  const hours = str(form, "followupCallHours").trim() || DEFAULT_CALL_HOURS;
  try {
    parseWeeklyHours(hours);
  } catch (err) {
    back(path, { error: `Calling hours: ${errMsg(err)}` });
  }
  const int = (key: string, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, optInt(form, key) ?? fallback));
  await db.receptionist.update({
    where: { id },
    data: {
      followupGoal: str(form, "followupGoal").slice(0, 500),
      followupQuestions: str(form, "followupQuestions").slice(0, 3000),
      followupGuardrails: str(form, "followupGuardrails").slice(0, 3000),
      greeting: str(form, "greeting").slice(0, 400),
      followupCallHours: hours,
      followupDelaySeconds: int("followupDelaySeconds", 0, 240, 60),
      followupMaxAttempts: int("followupMaxAttempts", 1, 3, 2),
      followupTextIfMissed: form.get("followupTextIfMissed") === "on",
    },
  });
  await markDirty(id);
  back(path, { notice: "Follow-up settings saved. Sync to ElevenLabs so the agent uses them." });
}

/** New form key: the old form address stops working (e.g. it was posted somewhere public by mistake). */
export async function rotateLeadFormKey(id: string) {
  await requireAdmin();
  await db.receptionist.update({ where: { id }, data: { leadFormKey: newLeadFormKey() } });
  back(`/crm/receptionists/${id}`, { notice: "New form address created. Update the client's website form with it." });
}

/** Send a pretend website lead with your own number: the agent calls you right away. */
export async function sendTestLead(id: string, form: FormData) {
  await requireReceptionist(id);
  const path = `/crm/receptionists/${id}`;
  const r = await db.receptionist.findUniqueOrThrow({ where: { id } });
  if (r.agentType !== "followup") back(path, { error: "This isn't a follow-up agent" });
  if (!r.elevenLabsAgentId) back(path, { error: "Sync to ElevenLabs first" });
  const { intakeLead, startFollowupCall } = await import("@/lib/followup");
  const { lead } = await intakeLead(r, { name: str(form, "name") || "Test lead", phone: str(form, "phone"), message: str(form, "message") || "I'd like a quote. Please call me back." }, { source: "test", consent: true, test: true });
  if (lead.status !== "NEW") back(path, { error: `Not called: ${lead.statusNote || lead.status}` });
  after(() => startFollowupCall(lead.id));
  back(path, { notice: `Calling ${lead.phone} now (${r.name}).` });
}

export async function updateReceptionist(id: string, form: FormData) {
  const session = await requireReceptionist(id);
  const isAdmin = session.role === "ADMIN";
  const ext = cleanDigits(str(form, "demoExtension"));
  const transfer = optStr(form, "escalationPhone");
  if (transfer && !dialableNumber(transfer)) back(`/crm/receptionists/${id}`, { error: "The transfer number must be a Canadian or US number with area code" });
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
      // Linking an existing ElevenLabs agent is an admin job (it could point at another client's agent).
      ...(isAdmin ? { elevenLabsAgentId: optStr(form, "elevenLabsAgentId") } : {}),
      demoExtension: ext || null,
    },
  });
  await markDirty(id);
  back(`/crm/receptionists/${id}`, { notice: "Saved" });
}

export async function markReviewed(accountId: string) {
  await guard(await requireStaff(), accountId);
  await db.account.update({ where: { id: accountId }, data: { needsReview: false } });
  revalidatePath("/crm", "layout");
  back(`/crm/accounts/${accountId}`, { notice: "Marked as reviewed" });
}

export async function updateBooking(id: string, form: FormData) {
  const session = await requireReceptionist(id);
  const isAdmin = session.role === "ADMIN";
  const path = `/crm/receptionists/${id}`;
  let availability: ReturnType<typeof availabilityFromForm>;
  try {
    availability = availabilityFromForm(form);
  } catch (err) {
    back(path, { error: `Bookable hours: ${errMsg(err)}` });
  }
  let leadAlertFields: ReturnType<typeof leadAlertFromForm>;
  try {
    leadAlertFields = leadAlertFromForm(form);
  } catch (err) {
    back(path, { error: errMsg(err) });
  }
  const int = (key: string, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, optInt(form, key) ?? fallback));
  await db.receptionist.update({
    where: { id },
    data: {
      bookingEnabled: form.get("bookingEnabled") === "on",
      bookingCalendarId: str(form, "bookingCalendarId") || "primary",
      bookingTitle: str(form, "bookingTitle") || "Discovery call",
      bookingSlotMinutes: int("bookingSlotMinutes", 10, 240, 30),
      bookingMinNoticeHours: int("bookingMinNoticeHours", 0, 336, 2),
      bookingDaysAhead: int("bookingDaysAhead", 1, 60, 14),
      bookingBufferMinutes: int("bookingBufferMinutes", 0, 120, 0),
      bookingMeetingType: ["google_meet", "caller_choice"].includes(str(form, "bookingMeetingType")) ? str(form, "bookingMeetingType") : "phone",
      bookingQuestions: str(form, "bookingQuestions"),
      ...availability,
      ...followUpFromForm(form),
      ...leadAlertFields,
      ...(isAdmin ? { bookingAddsToCrm: form.get("bookingAddsToCrm") === "on" } : {}),
      ...(await bookingGoogleFromForm(session, form)),
    },
  });
  await markDirty(id);
  back(path, { notice: "Booking settings saved. Sync to ElevenLabs to update the live agent." });
}

export async function getBusinessLine(id: string, form: FormData) {
  await requireAdmin();
  const path = `/crm/receptionists/${id}`;
  try {
    const ring = ringFromForm(form);
    if (!ring.ringFirstNumber) throw new Error("Enter the owner's cell number to ring first");
    await db.receptionist.update({ where: { id }, data: ring });
    const number = await provisionLine(id, { areaCode: str(form, "areaCode"), existing: str(form, "existingNumber") || undefined });
    back(path, { notice: `Business line ${number} is live: calls ring ${ring.ringFirstNumber} first, then the receptionist.` });
  } catch (err) {
    unstable_rethrow(err);
    back(path, { error: errMsg(err) });
  }
}

export async function saveRingSettings(id: string, form: FormData) {
  await requireAdmin();
  const path = `/crm/receptionists/${id}`;
  try {
    const ring = ringFromForm(form);
    const r = await db.receptionist.findUniqueOrThrow({ where: { id }, select: { existingNumber: true, keepNumberMethod: true } });
    if (forwardingLoop({ method: r.keepNumberMethod as KeepMethod, existingNumber: r.existingNumber, ringFirstNumber: ring.ringFirstNumber, ringMode: ring.ringMode })) {
      throw new Error(LOOP_MESSAGE);
    }
    await db.receptionist.update({ where: { id }, data: ring });
  } catch (err) {
    back(path, { error: errMsg(err) });
  }
  back(path, { notice: "Business line settings saved (they apply to the next call)" });
}

export async function removeBusinessLine(id: string, form: FormData) {
  await requireAdmin();
  const path = `/crm/receptionists/${id}`;
  const release = form.get("release") === "on";
  try {
    await removeLine(id, release);
  } catch (err) {
    unstable_rethrow(err);
    back(path, { error: errMsg(err) });
  }
  back(path, { notice: release ? "Business line removed and the number released to Twilio" : "Business line detached (the number is still on your Twilio account)" });
}

/** Run the same lookup the agent's get_available_times tool does, so you can sanity-check it. */
export async function previewOpenings(id: string) {
  await requireReceptionist(id);
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
  await requireReceptionist(id);
  try {
    const r = await syncReceptionist(id);
    back(`/crm/receptionists/${id}`, { notice: `Synced to ElevenLabs agent ${r.agentId} (${r.docs} KB documents)` });
  } catch (err) {
    unstable_rethrow(err);
    back(`/crm/receptionists/${id}`, { error: errMsg(err) });
  }
}

export async function draftKbFromWebsite(id: string) {
  await requireReceptionist(id);
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
    minimumMonths: Math.max(0, optInt(form, "minimumMonths") ?? 0),
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

export async function saveAiRoutes(form: FormData) {
  await requireAdmin();
  const { PROVIDERS, TASK_KEYS } = await import("@/lib/ai/types");
  const { saveRoutes } = await import("@/lib/ai/router");
  const provider = (v: string) => (PROVIDERS as readonly string[]).includes(v) ? (v as (typeof PROVIDERS)[number]) : null;
  const routes = Object.fromEntries(
    TASK_KEYS.map((t) => {
      const p = provider(str(form, `${t}_provider`)) ?? "anthropic";
      const fp = provider(str(form, `${t}_fb_provider`));
      const fm = str(form, `${t}_fb_model`).trim();
      return [t, { provider: p, model: str(form, `${t}_model`).trim() || (p === "gemini" ? "gemini-flash-latest" : "claude-sonnet-5-5"), fallback: fp && fm ? { provider: fp, model: fm } : null }];
    }),
  );
  await saveRoutes(routes as Parameters<typeof saveRoutes>[0]);
  back("/crm/settings", { notice: "AI models saved" });
}

export async function saveAutoResearch(form: FormData) {
  await requireAdmin();
  const { setSetting } = await import("@/lib/settings");
  const { AUTO_RESEARCH_KEY } = await import("@/lib/jobs");
  await setSetting(AUTO_RESEARCH_KEY, form.get("autoResearch") === "on" ? "on" : "off");
  back("/crm/settings", { notice: form.get("autoResearch") === "on" ? "New accounts will be researched automatically" : "Automatic research is off" });
}

export async function resetAiRoutes() {
  await requireAdmin();
  const { deleteSetting } = await import("@/lib/settings");
  await deleteSetting("ai.routes");
  back("/crm/settings", { notice: "AI models reset to defaults" });
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
  const session = await requireStaff();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.sub } });
  const bcrypt = (await import("bcryptjs")).default;
  if (!(await bcrypt.compare(str(form, "current"), user.passwordHash))) back("/crm/settings", { error: "Current password is incorrect" });
  const next = str(form, "next");
  if (next.length < 10) back("/crm/settings", { error: "New password must be at least 10 characters" });
  if (next !== str(form, "confirm")) back("/crm/settings", { error: "New passwords don't match" });
  // Signs out every other session (stolen cookies included); this browser gets a fresh one.
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), sessionsValidAfter: new Date() } });
  await new Promise((r) => setTimeout(r, 1000)); // the new cookie must be issued after the cut-off second
  await issueSession(user);
  back("/crm/settings", { notice: "Password changed. You've been signed out everywhere else." });
}

/** Remove your own Gmail & Calendar connection (the company connection is untouched). */
export async function disconnectMyGoogle() {
  const session = await requireStaff();
  const { disconnectPersonal } = await import("@/lib/google");
  await disconnectPersonal(session.sub);
  back("/crm/settings", { notice: "Your Gmail & Calendar are disconnected. You can also remove the app at myaccount.google.com/permissions." });
}

export async function disconnectGoogle() {
  await requireAdmin();
  const { deleteSetting } = await import("@/lib/settings");
  await deleteSetting("google.refresh_token");
  back("/crm/settings", { notice: "Google disconnected" });
}

/** Recreate the Drive folders and documents in the company Google account connected now. */
export async function rebuildDriveFolders() {
  await requireAdmin();
  const { googleConnection } = await import("@/lib/google");
  if (!(await googleConnection()).connected) back("/crm/settings", { error: "Connect the company Google account first" });
  const { rebuildDrive } = await import("@/lib/drive");
  const { deleteSetting } = await import("@/lib/settings");
  after(async () => {
    try {
      const r = await rebuildDrive();
      await deleteSetting("google.previousEmail");
      console.log("drive rebuilt", r);
    } catch (err) {
      console.error("drive rebuild failed", err);
    }
  });
  back("/crm/settings", { notice: "Rebuilding the Drive folders and documents in the connected account. This takes a minute or two." });
}

/** The address the app's own emails go out from: an alias of the company account, or blank for the account itself. */
export async function saveSendAs(form: FormData) {
  await requireAdmin();
  const { connectedEmail } = await import("@/lib/google");
  const { deleteSetting, setSetting } = await import("@/lib/settings");
  const value = str(form, "sendAs").toLowerCase();
  if (!value) {
    await deleteSetting("google.sendAs");
    back("/crm/settings", { notice: "App emails go out from the company Google account" });
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/.test(value)) back("/crm/settings", { error: "Enter an email address" });
  const company = await connectedEmail();
  if (company && value.split("@")[1] !== company.split("@")[1]) back("/crm/settings", { error: `Use an address on ${company.split("@")[1]} (an alias of ${company})` });
  await setSetting("google.sendAs", value);
  back("/crm/settings", { notice: `App emails will go out from ${value}. It must be an alias of the company account (Google Admin → Users → ${company ?? "the account"} → Alternate emails).` });
}

// --- Demo line ---------------------------------------------------------------------

/**
 * Whose Google Calendar a receptionist books into: "" = the company account (admins only), or a
 * person with their own connection. Reps can only pick themselves.
 */
async function bookingGoogleFromForm(session: SessionPayload, form: FormData): Promise<{ googleUserId?: string | null }> {
  if (!form.has("bookingGoogle")) return {};
  const pick = str(form, "bookingGoogle") || null;
  if (session.role !== "ADMIN" && pick !== session.sub) return {};
  if (pick && !(await googleConnection(pick)).connected) return {};
  return { googleUserId: pick };
}

/**
 * One click from a prospect's account: a demo receptionist for their business, answering on the
 * demo line under its own extension. Claude drafts its knowledge from their website, the drafts
 * go live (it's a demo built from public info) and it syncs to ElevenLabs; meetings booked on a
 * demo call land in the rep's own calendar. Re-running it opens the existing demo.
 */
export async function createDemoReceptionist(accountId: string, form: FormData) {
  const session = await requireStaff();
  await guard(session, accountId);
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { receptionists: { where: { demoExtension: { not: null } }, take: 1 } } });
  if (isClientStage(account.stage) && session.role !== "ADMIN") back(`/crm/accounts/${accountId}`, { error: "This account is a client: an administrator sets up its production receptionist" });
  if (account.receptionists[0]) back(`/crm/receptionists/${account.receptionists[0].id}`, { notice: "This prospect already has a demo receptionist" });
  if (!account.website && !account.domain) back(`/crm/accounts/${accountId}?edit=1`, { error: "Add the prospect's website first: the demo's knowledge is drafted from it" });
  const mine = await googleConnection(session.sub);
  const r = await db.receptionist.create({
    data: {
      accountId,
      name: str(form, "name") || "Ava",
      businessName: account.name,
      ragToken: randomBytes(24).toString("base64url"),
      demoExtension: await freeExtension(),
      createdById: session.sub,
      googleUserId: mine.connected ? session.sub : null,
      bookingEnabled: mine.calendar,
      bookingTitle: `Demo booking (${account.name})`,
      bookingAddsToCrm: false, // demo bookings are pretend customers, not leads
    },
  });
  const runId = await startKbDraft(r.id);
  after(async () => {
    await executeKbDraft(runId);
    await db.knowledgeItem.updateMany({ where: { receptionistId: r.id, tags: "claude-draft" }, data: { isActive: true } });
    try {
      await syncReceptionist(r.id);
      const { number } = await demoLineConfig();
      await recordActivity({ accountId, type: "NOTE", source: "system", subject: "Demo receptionist ready", body: `Call ${number ? formatPhone(number) : "the demo line"}, extension ${r.demoExtension}, to hear ${r.name} answer for ${account.name}.`, createdById: session.sub });
    } catch (err) {
      console.error("demo receptionist sync", err);
    }
  });
  back(`/crm/receptionists/${r.id}`, { notice: `Building ${account.name}'s demo: Claude is reading their website, then it syncs to ElevenLabs (a minute or two). Demo line extension ${r.demoExtension}.`, kbRun: runId });
}

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
