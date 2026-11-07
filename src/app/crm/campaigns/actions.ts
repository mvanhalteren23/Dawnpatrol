"use server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { optInt, str } from "@/lib/utils";
import { checkSteps, DEFAULT_STEPS, MAX_DAILY_PER_INBOX, MAX_STEPS, suppressionValue } from "@/lib/campaign-rules";
import { ADDRESS_KEY, LEGAL_NAME_KEY, addRecipients, availableSenders, parseCampaignSteps, parseSenders, runCampaigns, senderDetails } from "@/lib/campaigns";
import { suppress } from "@/lib/suppression";

function back(path: string, params?: Record<string, string>): never {
  revalidatePath(path);
  redirect(`${path}${params ? `?${new URLSearchParams(params).toString()}` : ""}`);
}

const err = (e: unknown) => (e as Error)?.message ?? String(e);

export async function createCampaign(form: FormData) {
  const session = await requireAdmin();
  const name = str(form, "name").trim() || "New campaign";
  const c = await db.campaign.create({ data: { name, steps: JSON.stringify(DEFAULT_STEPS), createdById: session.sub, senders: JSON.stringify((await availableSenders()).filter((s) => s.kind === "inbox" && !s.paused).map((s) => s.key)) } });
  back(`/crm/campaigns/${c.id}`, { notice: "Campaign created with a starter sequence. Edit the emails, pick senders and add recipients." });
}

export async function saveCampaign(id: string, form: FormData) {
  await requireAdmin();
  const path = `/crm/campaigns/${id}`;
  const raw = Array.from({ length: MAX_STEPS }, (_, i) => ({ delayDays: Number(str(form, `delay_${i}`) || 0), subject: str(form, `subject_${i}`), body: str(form, `body_${i}`) }));
  const checked = checkSteps(raw);
  if ("error" in checked) back(path, { error: checked.error });
  const valid = new Set((await availableSenders()).map((s) => s.key));
  const senders = form.getAll("sender").map(String).filter((s) => valid.has(s));
  const start = Math.min(23, Math.max(0, optInt(form, "sendStartHour") ?? 9));
  const end = Math.min(24, Math.max(start + 1, optInt(form, "sendEndHour") ?? 16));
  const timezone = str(form, "timezone").trim() || "America/Vancouver";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  } catch {
    back(path, { error: `Unknown time zone: ${timezone}` });
  }
  const fit = optInt(form, "prebuildMinFit");
  await db.campaign.update({
    where: { id },
    data: {
      name: str(form, "name").trim() || "Campaign",
      senders: JSON.stringify(senders),
      dailyPerInbox: Math.min(MAX_DAILY_PER_INBOX, Math.max(1, optInt(form, "dailyPerInbox") ?? 30)),
      sendStartHour: start,
      sendEndHour: end,
      timezone,
      weekdaysOnly: form.get("weekdaysOnly") === "on",
      buildDemoOnReply: form.get("buildDemoOnReply") === "on",
      prebuildMinFit: fit == null ? null : Math.min(100, Math.max(0, fit)),
      steps: JSON.stringify(checked.steps),
    },
  });
  back(path, { notice: "Saved" });
}

export async function setCampaignStatus(id: string, status: "ACTIVE" | "PAUSED" | "DONE") {
  await requireAdmin();
  const path = `/crm/campaigns/${id}`;
  const c = await db.campaign.findUniqueOrThrow({ where: { id } });
  if (status === "ACTIVE") {
    if (!parseCampaignSteps(c.steps).length) back(path, { error: "Fix the emails first" });
    if (!parseSenders(c.senders).length) back(path, { error: "Pick at least one inbox to send from" });
    if (!(await senderDetails()).address) back("/crm/campaigns", { error: "Add your business mailing address first (CASL requires it in every email)" });
    if (!(await db.campaignRecipient.count({ where: { campaignId: id, status: { in: ["QUEUED", "SENDING"] } } }))) back(path, { error: "Add recipients first" });
  }
  await db.campaign.update({ where: { id }, data: { status, lastError: null } });
  back(path, { notice: status === "ACTIVE" ? "Campaign is live. Emails go out every 30 minutes in the sending window, a few per inbox at a time." : status === "PAUSED" ? "Paused. Nothing more is sent until you resume (replies are still tracked)." : "Campaign finished. No more emails will be sent." });
}

export async function deleteCampaign(id: string) {
  await requireAdmin();
  const sent = await db.campaignRecipient.count({ where: { campaignId: id, step: { gt: 0 } } });
  if (sent) back(`/crm/campaigns/${id}`, { error: "Emails have gone out from this campaign: finish it instead, so its history stays" });
  await db.campaign.delete({ where: { id } });
  back("/crm/campaigns", { notice: "Campaign deleted" });
}

export async function addCampaignRecipients(id: string, form: FormData) {
  await requireAdmin();
  const path = `/crm/campaigns/${id}`;
  try {
    const n = await addRecipients(id, {
      stages: form.getAll("stage").map(String),
      tag: str(form, "tag").trim(),
      minFit: optInt(form, "minFit"),
      industry: str(form, "industry").trim(),
      city: str(form, "city").trim(),
      limit: Math.min(1000, Math.max(1, optInt(form, "limit") ?? 100)),
    });
    back(path, { notice: n ? `Added ${n} recipient${n === 1 ? "" : "s"}` : "No new matches: accounts need a contact with an email, can't be on the do-not-email list, or in another campaign" });
  } catch (e) {
    unstable_rethrow(e);
    back(path, { error: err(e) });
  }
}

export async function removeRecipient(id: string, recipientId: string) {
  await requireAdmin();
  await db.campaignRecipient.deleteMany({ where: { id: recipientId, campaignId: id, step: 0 } });
  back(`/crm/campaigns/${id}`, { notice: "Removed" });
}

export async function stopRecipient(id: string, recipientId: string) {
  await requireAdmin();
  await db.campaignRecipient.updateMany({ where: { id: recipientId, campaignId: id, status: { in: ["QUEUED", "SENDING"] } }, data: { status: "SKIPPED", nextSendAt: null, note: "Stopped by hand" } });
  back(`/crm/campaigns/${id}`, { notice: "No more emails to them from this campaign" });
}

export async function saveSenderDetails(form: FormData) {
  await requireAdmin();
  await setSetting(LEGAL_NAME_KEY, str(form, "legalName").trim());
  await setSetting(ADDRESS_KEY, str(form, "address").replace(/\s+/g, " ").trim());
  back("/crm/campaigns", { notice: "Saved. It appears at the bottom of every campaign email." });
}

export async function updateInbox(inboxId: string, form: FormData) {
  await requireAdmin();
  await db.outreachInbox.update({ where: { id: inboxId }, data: { displayName: str(form, "displayName").trim(), paused: form.get("paused") === "on" } });
  back("/crm/campaigns", { notice: "Inbox updated" });
}

export async function removeInbox(inboxId: string) {
  await requireAdmin();
  await db.outreachInbox.delete({ where: { id: inboxId } });
  const key = `inbox:${inboxId}`;
  for (const c of await db.campaign.findMany({ where: { senders: { contains: key } } })) {
    await db.campaign.update({ where: { id: c.id }, data: { senders: JSON.stringify(parseSenders(c.senders).filter((s) => s !== key)) } });
  }
  back("/crm/campaigns", { notice: "Inbox removed. Recipients it was sending to will wait until you reassign or stop them." });
}

export async function addSuppressionEntry(form: FormData) {
  const session = await requireAdmin();
  const values = str(form, "values").split(/[\s,;]+/).map(suppressionValue).filter((v): v is string => Boolean(v));
  if (!values.length) back("/crm/campaigns/unsubscribes", { error: "Enter an email address or a domain (e.g. @shop.com)" });
  let added = 0;
  const problems: string[] = [];
  for (const v of values) {
    try {
      await suppress(v, "manual", { note: str(form, "note").trim() || null, createdById: session.sub });
      added++;
    } catch (e) {
      problems.push(err(e));
    }
  }
  back("/crm/campaigns/unsubscribes", problems.length ? { error: problems.join(" · ") } : { notice: `Added ${added}` });
}

/** Only entries added by hand can be removed (e.g. a typo); people who asked stay on the list. */
export async function removeSuppressionEntry(entryId: string) {
  await requireAdmin();
  const e = await db.emailSuppression.findUnique({ where: { id: entryId } });
  if (e?.reason !== "manual") back("/crm/campaigns/unsubscribes", { error: "Only entries you added by hand can be removed. People who unsubscribed, replied or bounced stay on the list." });
  await db.emailSuppression.delete({ where: { id: entryId } });
  back("/crm/campaigns/unsubscribes", { notice: "Removed" });
}

/** Run a sending pass now (same rules as the scheduled one: window, daily limits). */
export async function runCampaignsNow() {
  await requireAdmin();
  let r: Awaited<ReturnType<typeof runCampaigns>>;
  try {
    r = await runCampaigns();
  } catch (e) {
    unstable_rethrow(e);
    back("/crm/campaigns", { error: err(e) });
  }
  if (r.demoRuns.length) {
    after(async () => {
      const { executeDemoResearch } = await import("@/lib/demo-research");
      for (const id of r.demoRuns) await executeDemoResearch(id);
    });
  }
  const msg = `Sent ${r.sent}, replies ${r.replies}, bounces ${r.bounces}, unsubscribes ${r.unsubscribes}, skipped ${r.skipped}${r.demoRuns.length ? `, ${r.demoRuns.length} demo agent${r.demoRuns.length === 1 ? "" : "s"} building` : ""}.`;
  back("/crm/campaigns", r.errors.length ? { error: `${msg} Problems: ${r.errors.slice(0, 3).join(" · ")}` } : { notice: msg });
}
