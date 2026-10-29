import "server-only";
import { db } from "./db";
import { companySendAs, connectedEmail, googleFetch, type GoogleAs } from "./google";
import { encodeHeader, safeAddress } from "./outreach-address";
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

  let activity;
  try {
    activity = await db.activity.create({
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
  } catch (err) {
    // The same email or call arriving twice at once (sync + webhook): the unique externalId wins.
    if (input.externalId && (err as { code?: string }).code === "P2002") return null;
    throw err;
  }

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

type SyncResult = { scanned: number; recorded: number; accountsTouched: string[]; errors: string[] };

/**
 * Track outreach from every connected mailbox: the company Google account and each person's
 * own Gmail. Emails a person sent are credited to them (Team page); replies mark the thread.
 */
export async function syncGmail(opts: { maxMessages?: number } = {}): Promise<SyncResult> {
  const total: SyncResult = { scanned: 0, recorded: 0, accountsTouched: [], errors: [] };
  const add = (r: Omit<SyncResult, "errors">) => {
    total.scanned += r.scanned;
    total.recorded += r.recorded;
    total.accountsTouched = Array.from(new Set([...total.accountsTouched, ...r.accountsTouched]));
  };
  const companyEmail = (await connectedEmail())?.toLowerCase() ?? null;
  // Who's who (contact emails, account domains) is the same for every mailbox: build it once.
  const [contacts, accounts] = await Promise.all([
    db.contact.findMany({ where: { email: { not: null } }, select: { id: true, accountId: true, email: true } }),
    db.account.findMany({ where: { domain: { not: null } }, select: { id: true, domain: true } }),
  ]);
  const index = buildMatchIndex(contacts, accounts);
  if (companyEmail) {
    try {
      const owner = await db.user.findFirst({ where: { email: { equals: companyEmail, mode: "insensitive" }, role: { in: ["ADMIN", "REP"] } }, select: { id: true } });
      const cursor = Number((await getSetting("gmail.cursor")) ?? 0);
      const r = await syncMailbox({ index, as: null, me: companyEmail, userId: owner?.id ?? null, since: cursor, maxMessages: opts.maxMessages });
      await setSetting("gmail.cursor", String(r.startedAt - 300)); // small overlap; externalId dedupes
      await setSetting("gmail.lastSyncAt", new Date().toISOString());
      add(r);
    } catch (err) {
      total.errors.push(`Company Gmail (${companyEmail}): ${(err as Error).message}`);
    }
  }
  const mailboxes = await db.googleAccount.findMany({ include: { user: { select: { disabled: true } } } });
  for (const g of mailboxes) {
    if (g.user.disabled || g.email.toLowerCase() === companyEmail) continue; // same mailbox as the company one
    try {
      const r = await syncMailbox({ index, as: g.userId, me: g.email.toLowerCase(), userId: g.userId, since: g.gmailCursor ?? 0, maxMessages: opts.maxMessages });
      await db.googleAccount.update({ where: { id: g.id }, data: { gmailCursor: r.startedAt - 300, lastSyncAt: new Date(), lastError: null } });
      add(r);
    } catch (err) {
      total.errors.push(`${g.email}: ${(err as Error).message}`);
      await db.googleAccount.update({ where: { id: g.id }, data: { lastError: (err as Error).message.slice(0, 500) } });
    }
  }
  if (!companyEmail && !mailboxes.length) throw new Error("Google is not connected");
  return total;
}

async function syncMailbox(o: { index: ReturnType<typeof buildMatchIndex>; as: string | null; me: string; userId: string | null; since: number; maxMessages?: number }) {
  const me = o.me;
  const since = o.since || Math.floor(Date.now() / 1000) - 14 * 86400;
  const startedAt = Math.floor(Date.now() / 1000);

  const index = o.index;
  const myDomain = me.split("@")[1];

  const ids: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  const max = o.maxMessages ?? 500;
  do {
    const q = encodeURIComponent(`after:${since} -in:chats -category:promotions -category:social`);
    const page = await googleFetch<GmailList>(`${GMAIL}/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`, {}, o.as);
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
    const msg = await googleFetch<GmailMessage>(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`, {}, o.as);
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
      createdById: outbound ? o.userId : null,
    });
    if (created) {
      recorded++;
      touched.add(match.accountId);
    }
  }
  return { scanned: ids.length, recorded, accountsTouched: Array.from(touched), startedAt };
}

/** Plain-text email from the connected Gmail account (no tracking, no activity). */
export async function sendPlainEmail(params: { to: string; subject: string; body: string; fromName?: string; replyTo?: string | null; as?: GoogleAs }) {
  const connected = await connectedEmail(params.as);
  if (!connected) throw new Error("Google is not connected");
  // Company emails can go out from an alias of the company account (e.g. hello@), set in Settings.
  const me = (!params.as && (await companySendAs())) || connected;
  const mime = [
    `From: ${params.fromName ? `${encodeHeader(params.fromName)} <${me}>` : me}`,
    `To: ${safeAddress(params.to)}`,
    ...(params.replyTo ? [`Reply-To: ${safeAddress(params.replyTo)}`] : []),
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
  }, params.as);
}

/**
 * Send with open/click tracking from the sender's own Gmail (or the company Gmail when no user is
 * given), and log it as an activity.
 */
export async function sendTrackedEmail(params: { accountId: string; contactId: string; subject: string; body: string; userId?: string }) {
  const contact = await db.contact.findUniqueOrThrow({ where: { id: params.contactId } });
  if (!contact.email) throw new Error("Contact has no email address");
  const me = await connectedEmail(params.userId);
  if (!me) throw new Error(params.userId ? "Connect your Gmail first: CRM → Settings → Your Gmail & Calendar." : "Google is not connected");

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
    `To: ${encodeHeader(contactName(contact).replace(/[<>"]/g, ""))} <${safeAddress(contact.email)}>`,
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
    }, params.userId);
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
