import "server-only";
import { db } from "./db";
import { connectedEmail, googleFetch } from "./google";
import { getSetting, setSetting } from "./settings";
import { writeAccountDoc } from "./drive";
import { buildMatchIndex, matchAddresses, nextFollowUp, nextStageAfterActivity } from "./outreach-rules";
import { instrumentHtml, textToHtml } from "./tracking";
import { PROSPECT_STAGES, type Stage } from "./constants";
import { contactName, extractEmailAddresses, formatDate } from "./utils";

export type NewActivity = {
  accountId: string;
  contactId?: string | null;
  type: string;
  direction?: "OUTBOUND" | "INBOUND" | null;
  subject?: string | null;
  body?: string | null;
  source?: string;
  externalId?: string | null;
  threadId?: string | null;
  occurredAt?: Date;
  dueAt?: Date | null;
  createdById?: string | null;
};

/**
 * Single entry point for every touch. Applies the automatic rules: stage advance,
 * last-contacted, follow-up scheduling, and reply detection on the thread.
 * Returns null when externalId was already recorded (idempotent for syncs/webhooks).
 */
export async function recordActivity(input: NewActivity) {
  if (input.externalId) {
    const existing = await db.activity.findUnique({ where: { externalId: input.externalId } });
    if (existing) return null;
  }
  const account = await db.account.findUniqueOrThrow({ where: { id: input.accountId } });
  const occurredAt = input.occurredAt ?? new Date();
  const direction = input.direction ?? null;

  const activity = await db.activity.create({
    data: {
      accountId: input.accountId,
      contactId: input.contactId ?? null,
      type: input.type,
      direction,
      subject: input.subject ?? null,
      body: input.body ?? null,
      source: input.source ?? "manual",
      externalId: input.externalId ?? null,
      threadId: input.threadId ?? null,
      occurredAt,
      dueAt: input.dueAt ?? null,
      createdById: input.createdById ?? null,
    },
  });

  const isProspect = (PROSPECT_STAGES as string[]).includes(account.stage);
  const newStage = nextStageAfterActivity(account.stage, input.type, direction);
  const followUp = nextFollowUp(input.type, direction, occurredAt, isProspect);
  const isTouch = direction !== null;
  const newer = !account.lastContactedAt || occurredAt > account.lastContactedAt;

  await db.account.update({
    where: { id: account.id },
    data: {
      ...(newStage !== account.stage ? { stage: newStage } : {}),
      ...(isTouch && newer ? { lastContactedAt: occurredAt } : {}),
      ...(followUp !== undefined && newer ? { nextFollowUpAt: followUp } : {}),
    },
  });

  if (newStage !== account.stage) {
    await db.activity.create({
      data: { accountId: account.id, type: "STAGE_CHANGE", source: "system", subject: `${account.stage} → ${newStage}`, body: `Automatically moved after ${input.type.toLowerCase()} (${direction?.toLowerCase()}).` },
    });
  }

  if (direction === "INBOUND" && input.threadId) {
    await db.activity.updateMany({
      where: { accountId: account.id, threadId: input.threadId, direction: "OUTBOUND", repliedAt: null },
      data: { repliedAt: occurredAt },
    });
  }
  return activity;
}

export async function changeStage(accountId: string, stage: Stage, userId?: string) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.stage === stage) return;
  await db.account.update({
    where: { id: accountId },
    data: {
      stage,
      ...(stage === "ACTIVE" && !account.convertedAt ? { convertedAt: new Date() } : {}),
      ...(!(PROSPECT_STAGES as string[]).includes(stage) ? { nextFollowUpAt: null } : {}),
    },
  });
  await db.activity.create({
    data: { accountId, type: "STAGE_CHANGE", source: userId ? "manual" : "system", subject: `${account.stage} → ${stage}`, createdById: userId ?? null },
  });
}

// --- Gmail ------------------------------------------------------------------------

type GmailList = { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function syncGmail(opts: { maxMessages?: number } = {}): Promise<{ scanned: number; recorded: number; accountsTouched: string[] }> {
  const me = (await connectedEmail())?.toLowerCase();
  if (!me) throw new Error("Google is not connected");
  const cursor = Number((await getSetting("gmail.cursor")) ?? 0);
  const since = cursor || Math.floor(Date.now() / 1000) - 14 * 86400;
  const startedAt = Math.floor(Date.now() / 1000);

  const [contacts, accounts] = await Promise.all([
    db.contact.findMany({ where: { email: { not: null } }, select: { id: true, accountId: true, email: true } }),
    db.account.findMany({ where: { domain: { not: null } }, select: { id: true, domain: true } }),
  ]);
  const index = buildMatchIndex(contacts, accounts);
  const myDomain = me.split("@")[1];

  const ids: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  const max = opts.maxMessages ?? 500;
  do {
    const q = encodeURIComponent(`after:${since} -in:chats -category:promotions -category:social`);
    const page = await googleFetch<GmailList>(`${GMAIL}/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
    ids.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);

  const known = new Set(
    (await db.activity.findMany({ where: { externalId: { in: ids.map((m) => `gmail:${m.id}`) } }, select: { externalId: true } })).map((a) => a.externalId),
  );

  let recorded = 0;
  const touched = new Set<string>();
  for (const { id } of ids.slice(0, max)) {
    if (known.has(`gmail:${id}`)) continue;
    const msg = await googleFetch<GmailMessage>(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`);
    const header = (n: string) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    const from = extractEmailAddresses(header("From"));
    const outbound = from.includes(me);
    const counterpart = (outbound ? [...extractEmailAddresses(header("To")), ...extractEmailAddresses(header("Cc"))] : from)
      // Gmail personal accounts share a domain with millions — only skip our own domain for Workspace.
      .filter((a) => a !== me && (myDomain === "gmail.com" || !a.endsWith(`@${myDomain}`)));
    const match = matchAddresses(counterpart, index);
    if (!match) continue;
    const created = await recordActivity({
      accountId: match.accountId,
      contactId: match.contactId,
      type: "EMAIL",
      direction: outbound ? "OUTBOUND" : "INBOUND",
      subject: header("Subject") || "(no subject)",
      body: msg.snippet ?? null,
      source: "gmail",
      externalId: `gmail:${msg.id}`,
      threadId: msg.threadId,
      occurredAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    });
    if (created) {
      recorded++;
      touched.add(match.accountId);
    }
  }
  await setSetting("gmail.cursor", String(startedAt - 300)); // small overlap; externalId dedupes
  await setSetting("gmail.lastSyncAt", new Date().toISOString());
  return { scanned: ids.length, recorded, accountsTouched: Array.from(touched) };
}

function encodeHeader(value: string): string {
  // RFC 2047 for non-ASCII subjects
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

/** Plain-text email from the connected Gmail account (no tracking, no activity). */
export async function sendPlainEmail(params: { to: string; subject: string; body: string; fromName?: string; replyTo?: string | null }) {
  const me = await connectedEmail();
  if (!me) throw new Error("Google is not connected");
  const mime = [
    `From: ${params.fromName ? `${encodeHeader(params.fromName)} <${me}>` : me}`,
    `To: ${params.to}`,
    ...(params.replyTo ? [`Reply-To: ${params.replyTo}`] : []),
    `Subject: ${encodeHeader(params.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    params.body,
  ].join("\r\n");
  return googleFetch<{ id: string; threadId: string }>(`${GMAIL}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
  });
}

/** Send from the connected Gmail account with open/click tracking, and log it as an activity. */
export async function sendTrackedEmail(params: { accountId: string; contactId: string; subject: string; body: string; userId?: string }) {
  const contact = await db.contact.findUniqueOrThrow({ where: { id: params.contactId } });
  if (!contact.email) throw new Error("Contact has no email address");
  const me = await connectedEmail();
  if (!me) throw new Error("Google is not connected");

  const activity = await recordActivity({
    accountId: params.accountId,
    contactId: contact.id,
    type: "EMAIL",
    direction: "OUTBOUND",
    subject: params.subject,
    body: params.body,
    source: "crm-send",
    createdById: params.userId ?? null,
  });
  if (!activity) throw new Error("Could not record activity");

  const html = instrumentHtml(textToHtml(params.body), activity.id, process.env.APP_URL ?? "");
  const mime = [
    `From: ${me}`,
    `To: ${contactName(contact)} <${contact.email}>`,
    `Subject: ${encodeHeader(params.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
  try {
    const sent = await googleFetch<{ id: string; threadId: string }>(`${GMAIL}/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
    });
    await db.activity.update({ where: { id: activity.id }, data: { externalId: `gmail:${sent.id}`, threadId: sent.threadId } });
  } catch (err) {
    await db.activity.update({ where: { id: activity.id }, data: { subject: `[NOT SENT] ${params.subject}`, body: `${params.body}\n\nSend failed: ${(err as Error).message}` } });
    throw err;
  }
  return activity;
}

/** Mirror the account's outreach history into a single Google Doc in its Outreach folder. */
export async function writeOutreachLog(accountId: string) {
  const account = await db.account.findUniqueOrThrow({
    where: { id: accountId },
    include: { activities: { orderBy: { occurredAt: "desc" }, take: 500, include: { contact: true } } },
  });
  const lines = account.activities.map((a) => {
    const who = a.contact ? ` — ${contactName(a.contact)}` : "";
    const stats = a.type === "EMAIL" && a.direction === "OUTBOUND" ? ` [opens: ${a.openCount}, clicks: ${a.clickCount}${a.repliedAt ? ", replied" : ""}]` : "";
    return `${formatDate(a.occurredAt, true)} · ${a.type}${a.direction ? ` (${a.direction.toLowerCase()})` : ""}${who}${stats}\n${a.subject ?? ""}${a.body ? `\n${a.body.slice(0, 1000)}` : ""}\n`;
  });
  const content = `Outreach log — ${account.name}\nStage: ${account.stage}\nLast updated: ${new Date().toISOString()}\n\n${lines.join("\n")}`;
  const key = `drive.outreachLog.${accountId}`;
  const file = await writeAccountDoc(accountId, "OUTREACH", `Outreach Log — ${account.name}`, content, await getSetting(key));
  await setSetting(key, file.id);
  return file;
}
