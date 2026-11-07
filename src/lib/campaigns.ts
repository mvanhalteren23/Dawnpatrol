import "server-only";
import { db } from "./db";
import { appUrl } from "./app-url";
import { getSetting, setSetting } from "./settings";
import { companyName } from "./brand";
import { googleFetch, GoogleApiError, type GoogleAs } from "./google";
import { encodeHeader, safeAddress } from "./outreach-address";
import { recordActivity } from "./outreach";
import { isSuppressed, suppress } from "./suppression";
import { isClientStage } from "./constants";
import { extractEmailAddresses } from "./utils";
import {
  checkSteps,
  cleanPersonalLine,
  emailFooter,
  followUpSubject,
  greetingName,
  inSendWindow,
  isAutoReply,
  isBounce,
  isEmailOptOut,
  localParts,
  nextSendAt,
  normalizeEmail,
  pickSender,
  renderTemplate,
  sendsThisRun,
  type CampaignStep,
  type TemplateVars,
} from "./campaign-rules";
import { oneClickUrl, unsubscribeUrl } from "./unsubscribe-token";

// Cold email campaigns: a short sequence of plain-text emails, sent from connected mailboxes a
// few at a time inside business hours, each follow-up in the same thread. Replies and bounces
// stop the sequence; "unsubscribe" replies and links go on the do-not-email list; a real reply
// can build the prospect's demo agent straight away. Runs from /api/cron/campaigns every 30 min.

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const LIVE = ["QUEUED", "SENDING"];

export const LEGAL_NAME_KEY = "campaign.legalName";
export const ADDRESS_KEY = "campaign.address";

export async function senderDetails(): Promise<{ legalName: string; address: string }> {
  const [legalName, address, company] = await Promise.all([getSetting(LEGAL_NAME_KEY), getSetting(ADDRESS_KEY), companyName()]);
  return { legalName: legalName || company, address: address ?? "" };
}

export function parseSenders(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

export function parseCampaignSteps(json: string): CampaignStep[] {
  try {
    const r = checkSteps(JSON.parse(json));
    return "steps" in r ? r.steps : [];
  } catch {
    return [];
  }
}

/** Mailboxes a campaign can send from: campaign inboxes, and staff members' own connected Gmail. */
export async function availableSenders(): Promise<{ key: string; email: string; name: string; paused: boolean; error: string | null; kind: "inbox" | "person" }[]> {
  const [inboxes, people] = await Promise.all([
    db.outreachInbox.findMany({ orderBy: { createdAt: "asc" } }),
    db.googleAccount.findMany({ where: { user: { disabled: false, role: { in: ["ADMIN", "REP"] } } }, include: { user: { select: { name: true, email: true } } } }),
  ]);
  return [
    ...inboxes.map((i) => ({ key: `inbox:${i.id}`, email: i.email, name: i.displayName, paused: i.paused, error: i.lastError, kind: "inbox" as const })),
    ...people.filter((g) => g.scopes.includes("gmail.send")).map((g) => ({ key: g.userId, email: g.email, name: g.user.name ?? "", paused: false, error: g.lastError, kind: "person" as const })),
  ];
}

async function senderIdentity(key: string): Promise<{ email: string; name: string; paused: boolean } | null> {
  if (key.startsWith("inbox:")) {
    const i = await db.outreachInbox.findUnique({ where: { id: key.slice(6) } });
    return i ? { email: i.email, name: i.displayName || (await companyName()), paused: i.paused } : null;
  }
  const g = await db.googleAccount.findUnique({ where: { userId: key }, include: { user: { select: { name: true, disabled: true } } } });
  return g && !g.user.disabled ? { email: g.email, name: g.user.name ?? "", paused: false } : null;
}

const sentKey = (sender: string, date: string) => `campaign.sent.${sender}.${date}`;

export async function sentToday(sender: string, timezone: string, now = new Date()): Promise<number> {
  return Number((await getSetting(sentKey(sender, localParts(now, timezone).date))) ?? 0) || 0;
}

async function countSend(sender: string, timezone: string, now: Date) {
  const key = sentKey(sender, localParts(now, timezone).date);
  await setSetting(key, String((Number((await getSetting(key)) ?? 0) || 0) + 1));
}

// --- Personalisation ---------------------------------------------------------

function publicSite(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const h = u.hostname.toLowerCase();
    if (!/^https?:$/.test(u.protocol) || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return null;
    return u;
  } catch {
    return null;
  }
}

/** The visible text of a business's home page (for the personal line). */
async function siteText(website: string | null | undefined): Promise<string> {
  const url = publicSite(website);
  if (!url) return "";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HeadAboveDigital/1.0; +https://www.headabovedigital.com)" }, signal: AbortSignal.timeout(8000), redirect: "follow" }).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
  const html = (await res.text()).slice(0, 400_000);
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

/** The recipient's personal line, written once and kept ("" = tried, nothing specific). */
async function personalLine(r: { id: string; personalLine: string | null }, account: { name: string; website: string | null; domain: string | null; city: string | null; industry: string | null }): Promise<string> {
  if (r.personalLine !== null) return r.personalLine;
  let line = "";
  try {
    const text = await siteText(account.website ?? account.domain);
    if (text.length > 200) {
      const { writePersonalLine } = await import("./ai");
      line = cleanPersonalLine(await writePersonalLine({ businessName: account.name, city: account.city ?? "", industry: account.industry ?? "", siteText: text })) ?? "";
    }
  } catch (err) {
    console.warn("campaign personal line", err);
  }
  await db.campaignRecipient.update({ where: { id: r.id }, data: { personalLine: line } });
  return line;
}

async function demoLine(accountId: string): Promise<string> {
  const demo = await db.receptionist.findFirst({ where: { accountId, lifecycle: "demo", demoExtension: { not: null } }, orderBy: { createdAt: "desc" }, select: { demoExtension: true } });
  if (!demo) return "";
  const { demoLineConfig, formatPhone } = await import("./demo-line");
  const { number } = await demoLineConfig();
  return number ? `You can hear it now: call ${formatPhone(number)} and press ${demo.demoExtension}.` : "";
}

type RecipientFull = Awaited<ReturnType<typeof loadRecipient>>;
function loadRecipient(id: string) {
  return db.campaignRecipient.findUniqueOrThrow({ where: { id }, include: { account: true } });
}

/** The email a recipient gets for a step (subject, body with footer). */
export async function renderFor(r: RecipientFull, step: CampaignStep, stepIndex: number, sender: { name: string }, o: { withAi: boolean }) {
  const vars: TemplateVars = {
    first_name: greetingName(r.firstName),
    company: r.account.name,
    city: r.account.city,
    website: r.account.website ?? r.account.domain,
    personal_line: o.withAi ? await personalLine(r, r.account) : r.personalLine ?? "",
    demo_line: await demoLine(r.accountId),
    sender_name: sender.name.split(" ")[0] || sender.name,
  };
  const { legalName, address } = await senderDetails();
  const body = `${renderTemplate(step.body, vars)}\n\n${emailFooter({ legalName, address: address || "[mailing address not set]", unsubscribeUrl: unsubscribeUrl(appUrl(), r.email) })}`;
  const subject = stepIndex === 0 || !r.firstSubject ? renderTemplate(step.subject, vars) : step.subject.trim() ? renderTemplate(step.subject, vars) : followUpSubject(r.firstSubject);
  return { subject, body };
}

// --- Sending -------------------------------------------------------------------

async function sendEmail(sender: string, from: { email: string; name: string }, r: RecipientFull, email: { subject: string; body: string }) {
  const threaded = Boolean(r.threadId && r.messageId);
  const b64 = Buffer.from(email.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const mime = [
    `From: ${from.name ? `${encodeHeader(from.name.replace(/[<>"]/g, ""))} <${from.email}>` : from.email}`,
    `To: ${safeAddress(r.email)}`,
    `Subject: ${encodeHeader(email.subject)}`,
    ...(threaded ? [`In-Reply-To: ${r.messageId}`, `References: ${r.messageId}`] : []),
    `List-Unsubscribe: <${oneClickUrl(appUrl(), r.email)}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64,
  ].join("\r\n");
  const sent = await googleFetch<{ id: string; threadId: string }>(`${GMAIL}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url"), ...(threaded ? { threadId: r.threadId } : {}) }),
  }, sender as GoogleAs);
  // Gmail sets the Message-ID; keep it so the next follow-up threads for the recipient too.
  const meta = await googleFetch<{ payload?: { headers?: { name: string; value: string }[] } }>(`${GMAIL}/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`, {}, sender as GoogleAs).catch(() => null);
  const messageId = meta?.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
  return { id: sent.id, threadId: sent.threadId, messageId };
}

type Campaign = NonNullable<Awaited<ReturnType<typeof db.campaign.findUnique>>>;
export type RunResult = { sent: number; replies: number; bounces: number; unsubscribes: number; skipped: number; demoRuns: string[]; errors: string[] };

/** One sending run across every active campaign. Demo research runs to start are returned (run them after responding). */
export async function runCampaigns(now = new Date()): Promise<RunResult> {
  const out: RunResult = { sent: 0, replies: 0, bounces: 0, unsubscribes: 0, skipped: 0, demoRuns: [], errors: [] };
  await checkReplies(out).catch((e) => out.errors.push(`Reply check: ${(e as Error).message}`));
  const campaigns = await db.campaign.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  for (const c of campaigns) {
    try {
      await runCampaign(c, now, out);
    } catch (err) {
      out.errors.push(`${c.name}: ${(err as Error).message}`);
      await db.campaign.update({ where: { id: c.id }, data: { lastError: (err as Error).message.slice(0, 500) } });
    }
  }
  return out;
}

async function runCampaign(c: Campaign, now: Date, out: RunResult) {
  const steps = parseCampaignSteps(c.steps);
  if (!steps.length) throw new Error("The sequence has no valid emails");
  const left = await db.campaignRecipient.count({ where: { campaignId: c.id, status: { in: LIVE } } });
  if (!left) {
    await db.campaign.update({ where: { id: c.id }, data: { status: "DONE" } });
    return;
  }
  if (!inSendWindow(now, c)) return;
  const { address } = await senderDetails();
  if (!address) throw new Error("Add your mailing address on the Campaigns page first (required in every email)");

  // How many each mailbox may send on this run.
  const budget = new Map<string, number>();
  const identity = new Map<string, { email: string; name: string }>();
  for (const s of parseSenders(c.senders)) {
    const who = await senderIdentity(s);
    if (!who || who.paused) continue;
    identity.set(s, who);
    const remaining = Math.max(0, c.dailyPerInbox - (await sentToday(s, c.timezone, now)));
    budget.set(s, sendsThisRun({ remainingToday: remaining, now, timezone: c.timezone, sendEndHour: c.sendEndHour }));
  }
  const total = Array.from(budget.values()).reduce((a, b) => a + b, 0);
  if (!total) return;

  const due = await db.campaignRecipient.findMany({
    where: { campaignId: c.id, status: { in: LIVE }, OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }] },
    orderBy: [{ step: "desc" }, { createdAt: "asc" }],
    take: total * 3,
    include: { account: true },
  });
  for (const r of due) {
    if (Array.from(budget.values()).every((n) => n <= 0)) break;
    // Checks before every email.
    if (await isSuppressed(r.email)) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "UNSUBSCRIBED", nextSendAt: null, note: "On the do-not-email list" } });
      out.skipped++;
      continue;
    }
    if (isClientStage(r.account.stage) || ["DEMO", "PROPOSAL", "LOST", "CHURNED"].includes(r.account.stage)) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", nextSendAt: null, note: `Account is now ${r.account.stage.toLowerCase()}` } });
      out.skipped++;
      continue;
    }
    const answered = await db.activity.findFirst({ where: { accountId: r.accountId, direction: "INBOUND", occurredAt: { gte: r.createdAt } }, select: { occurredAt: true } });
    if (answered) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "REPLIED", repliedAt: r.repliedAt ?? answered.occurredAt, nextSendAt: null, note: "They've been in touch since this campaign started" } });
      out.skipped++;
      continue;
    }
    // Optional: build their demo before the first email, so it can say "call it now".
    if (r.step === 0 && c.prebuildMinFit != null && (r.account.fitScore ?? 0) >= c.prebuildMinFit) {
      const waiting = await demoBeforeFirstEmail(c, r, now, out);
      if (waiting) continue;
    }
    const sender = r.sender && budget.has(r.sender) ? r.sender : r.sender ? null : pickSender(Array.from(budget, ([sender, remaining]) => ({ sender, remaining })));
    if (!sender) {
      if (r.sender && !identity.has(r.sender)) await db.campaignRecipient.update({ where: { id: r.id }, data: { note: "Its sending inbox isn't available (paused, removed or not on this campaign)" } });
      continue;
    }
    if ((budget.get(sender) ?? 0) <= 0) continue;
    const step = steps[r.step];
    if (!step) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "DONE", nextSendAt: null } });
      continue;
    }
    const from = identity.get(sender)!;
    try {
      const email = await renderFor(r, step, r.step, from, { withAi: true });
      const sent = await sendEmail(sender, from, r, email);
      const at = new Date();
      await recordActivity({ accountId: r.accountId, contactId: r.contactId, type: "EMAIL", direction: "OUTBOUND", subject: email.subject, body: email.body, source: "campaign", externalId: `gmail:${sent.id}`, threadId: sent.threadId, occurredAt: at, createdById: c.createdById });
      const next = nextSendAt(steps, r.step + 1, at);
      await db.campaignRecipient.update({
        where: { id: r.id },
        data: { step: r.step + 1, status: next ? "SENDING" : "DONE", nextSendAt: next, sender, threadId: sent.threadId, messageId: sent.messageId ?? r.messageId, firstSubject: r.firstSubject ?? email.subject, lastSentAt: at, note: null },
      });
      budget.set(sender, (budget.get(sender) ?? 1) - 1);
      await countSend(sender, c.timezone, at);
      out.sent++;
    } catch (err) {
      const e = err as Error;
      if (err instanceof GoogleApiError && (err.status === 401 || err.status === 403 || err.status === 429)) {
        budget.set(sender, 0); // this mailbox is out for this run
        out.errors.push(`${from.email}: ${e.message.slice(0, 200)}`);
        if (sender.startsWith("inbox:")) await db.outreachInbox.update({ where: { id: sender.slice(6) }, data: { lastError: e.message.slice(0, 500) } }).catch(() => undefined);
      } else if (/valid email address|Invalid To header|invalid_argument/i.test(e.message)) {
        await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", nextSendAt: null, note: `Not sent: ${e.message.slice(0, 200)}` } });
        out.skipped++;
      } else {
        out.errors.push(`${r.email}: ${e.message.slice(0, 200)}`);
        await db.campaignRecipient.update({ where: { id: r.id }, data: { nextSendAt: new Date(now.getTime() + 2 * 3600_000), note: `Send failed, retrying later: ${e.message.slice(0, 200)}` } });
      }
    }
  }
}

/** True while their demo is being built (the first email waits for it, at most 2 hours). */
async function demoBeforeFirstEmail(c: Campaign, r: RecipientFull, now: Date, out: RunResult): Promise<boolean> {
  const hasDemo = await db.receptionist.findFirst({ where: { accountId: r.accountId, lifecycle: "demo" }, select: { id: true } });
  if (hasDemo) return false;
  if (r.demoRunId) {
    const run = await db.researchRun.findUnique({ where: { id: r.demoRunId }, select: { status: true, createdAt: true } });
    if (run?.status === "RUNNING" && now.getTime() - run.createdAt.getTime() < 2 * 3600_000) return true;
    return false; // finished (or failed): send with or without it
  }
  const runId = await startDemo(c, r.accountId).catch((e) => {
    out.errors.push(`Demo for ${r.account.name}: ${(e as Error).message}`);
    return null;
  });
  if (!runId) return false;
  out.demoRuns.push(runId);
  await db.campaignRecipient.update({ where: { id: r.id }, data: { demoRunId: runId, nextSendAt: new Date(now.getTime() + 20 * 60_000), note: "Building their demo agent before the first email" } });
  return true;
}

async function startDemo(c: Campaign, accountId: string): Promise<string> {
  const { startDemoResearch } = await import("./demo-research");
  return startDemoResearch(accountId, { receptionistId: null, createdById: c.createdById, googleUserId: null, bookingEnabled: false, agentName: "Ava" });
}

// --- Replies, bounces, unsubscribes ------------------------------------------------

type GmailMessage = { id: string; threadId: string; snippet?: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };

/** Look at new mail in every sending mailbox for replies and bounces on campaign threads. */
async function checkReplies(out: RunResult) {
  const senders = await db.campaignRecipient.findMany({ where: { sender: { not: null }, threadId: { not: null }, campaign: { status: { in: ["ACTIVE", "PAUSED", "DONE"] } }, OR: [{ lastSentAt: { gte: new Date(Date.now() - 45 * 86_400_000) } }] }, distinct: ["sender"], select: { sender: true } });
  for (const { sender } of senders) {
    if (!sender) continue;
    try {
      await checkMailbox(sender, out);
    } catch (err) {
      out.errors.push(`Replies for ${sender}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
}

async function checkMailbox(sender: string, out: RunResult) {
  const who = await senderIdentity(sender);
  if (!who) return;
  const me = who.email.toLowerCase();
  const key = `campaign.replyCursor.${sender}`;
  const since = Number((await getSetting(key)) ?? 0) || Math.floor(Date.now() / 1000) - 2 * 86400;
  const startedAt = Math.floor(Date.now() / 1000);
  const q = encodeURIComponent(`after:${since} -from:me`);
  const list = await googleFetch<{ messages?: { id: string; threadId: string }[] }>(`${GMAIL}/messages?q=${q}&maxResults=100`, {}, sender as GoogleAs);
  const messages = list.messages ?? [];
  const threads = new Set(messages.map((m) => m.threadId));
  const recipients = threads.size ? await db.campaignRecipient.findMany({ where: { sender, threadId: { in: Array.from(threads) } }, include: { campaign: true, account: true } }) : [];
  const byThread = new Map(recipients.map((r) => [r.threadId!, r]));
  for (const m of messages) {
    const r = byThread.get(m.threadId);
    if (!r) continue;
    if (await db.activity.findUnique({ where: { externalId: `gmail:${m.id}` }, select: { id: true } })) continue;
    const msg = await googleFetch<GmailMessage>(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, {}, sender as GoogleAs);
    const header = (n: string) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    const from = header("From");
    if (extractEmailAddresses(from).includes(me)) continue;
    const subject = header("Subject");
    const text = msg.snippet ?? "";
    const at = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
    if (isBounce(from, subject)) {
      await suppress(r.email, "bounce", { note: subject.slice(0, 200), campaignId: r.campaignId });
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "BOUNCED", nextSendAt: null, note: `Bounced: ${text.slice(0, 160)}` } });
      await db.activity.create({ data: { accountId: r.accountId, type: "NOTE", source: "system", subject: `Campaign email to ${r.email} bounced`, body: text.slice(0, 500), externalId: `gmail:${m.id}` } }).catch(() => undefined);
      out.bounces++;
      continue;
    }
    if (isAutoReply(subject, text)) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { note: `Auto-reply: ${subject.slice(0, 120)}` } });
      continue;
    }
    await recordActivity({ accountId: r.accountId, contactId: r.contactId, type: "EMAIL", direction: "INBOUND", subject: subject || "(no subject)", body: text, source: "campaign", externalId: `gmail:${m.id}`, threadId: m.threadId, occurredAt: at });
    out.replies++;
    if (isEmailOptOut(text)) {
      await suppress(r.email, "reply", { note: text.slice(0, 200), campaignId: r.campaignId });
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "UNSUBSCRIBED", repliedAt: at, nextSendAt: null, note: "Asked not to be emailed" } });
      out.unsubscribes++;
      continue;
    }
    await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "REPLIED", repliedAt: at, nextSendAt: null, note: null } });
    await onReply(r, text, out);
  }
  await setSetting(key, String(startedAt - 300));
}

/** Someone replied: tell the team, and build their demo agent so the answer can be "call it now". */
async function onReply(r: { id: string; accountId: string; email: string; demoRunId: string | null; campaign: Campaign; account: { name: string } }, text: string, out: RunResult) {
  let demoNote = "";
  if (r.campaign.buildDemoOnReply) {
    const hasDemo = await db.receptionist.findFirst({ where: { accountId: r.accountId, lifecycle: "demo" }, select: { demoExtension: true } });
    if (hasDemo) demoNote = `Their demo agent is ready on extension ${hasDemo.demoExtension}.`;
    else if (!r.demoRunId) {
      const runId = await startDemo(r.campaign, r.accountId).catch(() => null);
      if (runId) {
        out.demoRuns.push(runId);
        await db.campaignRecipient.update({ where: { id: r.id }, data: { demoRunId: runId } });
        demoNote = "Their demo agent is being built now (a few minutes); the account page shows the extension when it's ready.";
      }
    }
  }
  await recordActivity({ accountId: r.accountId, type: "TASK", source: "system", subject: `Reply to ${r.account.name} (campaign reply)`, body: `${text.slice(0, 500)}\n\n${demoNote}`.trim(), dueAt: new Date() });
  const { alertTeam } = await import("./call-guard");
  await alertTeam(`Campaign reply from ${r.account.name}`, `"${text.slice(0, 200)}" (${r.email}). ${demoNote} ${appUrl()}/crm/accounts/${r.accountId}`.trim()).catch(() => undefined);
}

// --- Recipients --------------------------------------------------------------------

export type RecipientFilter = { stages: string[]; tag: string; minFit: number | null; industry: string; city: string; limit: number };

/** Accounts that match, with an email to use, minus anyone on the list or already in a campaign. */
export async function findRecipients(f: RecipientFilter) {
  const accounts = await db.account.findMany({
    where: {
      stage: { in: f.stages.length ? f.stages : ["PROSPECT"] },
      ...(f.tag ? { tags: { contains: f.tag, mode: "insensitive" } } : {}),
      ...(f.minFit != null ? { fitScore: { gte: f.minFit } } : {}),
      ...(f.industry ? { industry: { contains: f.industry, mode: "insensitive" } } : {}),
      ...(f.city ? { city: { contains: f.city, mode: "insensitive" } } : {}),
      contacts: { some: { email: { not: null } } },
      campaignRecipients: { none: { status: { in: ["QUEUED", "SENDING", "REPLIED", "UNSUBSCRIBED", "BOUNCED"] } } },
    },
    include: { contacts: { where: { email: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    take: Math.min(Math.max(f.limit, 1), 1000) * 2,
  });
  const values = accounts.flatMap((a) => a.contacts.map((c) => normalizeEmail(c.email!)));
  const domains = Array.from(new Set(values.map((v) => `@${v.split("@")[1]}`)));
  const blocked = new Set((await db.emailSuppression.findMany({ where: { value: { in: [...values, ...domains] } }, select: { value: true } })).map((s) => s.value));
  const picked: { account: (typeof accounts)[number]; contact: (typeof accounts)[number]["contacts"][number]; email: string }[] = [];
  for (const a of accounts) {
    const contact = a.contacts.find((c) => {
      const e = normalizeEmail(c.email!);
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !blocked.has(e) && !blocked.has(`@${e.split("@")[1]}`);
    });
    if (contact) picked.push({ account: a, contact, email: normalizeEmail(contact.email!) });
    if (picked.length >= f.limit) break;
  }
  return picked;
}

export async function addRecipients(campaignId: string, f: RecipientFilter): Promise<number> {
  const picked = await findRecipients(f);
  const res = await db.campaignRecipient.createMany({
    data: picked.map((p) => ({
      campaignId,
      accountId: p.account.id,
      contactId: p.contact.id,
      email: p.email,
      firstName: p.contact.firstName,
      emailSource: `CRM contact on ${p.account.name} (account added by ${p.account.source})`,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/** The emails one recipient would get (for the preview), optionally with their AI personal line. */
export async function previewRecipient(recipientId: string, withAi: boolean) {
  const r = await loadRecipient(recipientId);
  const c = await db.campaign.findUniqueOrThrow({ where: { id: r.campaignId } });
  const steps = parseCampaignSteps(c.steps);
  const senderKey = r.sender ?? parseSenders(c.senders)[0];
  const who = (senderKey ? await senderIdentity(senderKey) : null) ?? { name: "Matt", email: "" };
  const fake = { ...r, firstSubject: null as string | null };
  const emails = [];
  for (const [i, s] of steps.entries()) {
    const e = await renderFor(i === 0 ? fake : { ...fake, firstSubject: emails[0]?.subject ?? null }, s, i, who, { withAi: withAi && i === 0 });
    emails.push({ ...e, delayDays: s.delayDays });
  }
  return { recipient: r, emails };
}
