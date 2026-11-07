import "server-only";
import { db } from "./db";
import { isSharedMailDomain, normalizeEmail, suppressionKeys } from "./campaign-rules";

// The do-not-email list. Every sales email (campaigns and emails sent from the CRM) is checked
// against it first. Entries are never removed automatically: it's the record CASL asks for.

export type SuppressReason = "link" | "one-click" | "reply" | "bounce" | "manual";

/** The entry that blocks this address (the address itself or its whole domain), if any. */
export async function suppressionFor(email: string) {
  return db.emailSuppression.findFirst({ where: { value: { in: suppressionKeys(email) } } });
}

export async function isSuppressed(email: string): Promise<boolean> {
  return Boolean(await suppressionFor(email));
}

/** Add an address (or "@domain") to the list. Re-adding keeps the first record. */
export async function suppress(value: string, reason: SuppressReason, o: { note?: string | null; campaignId?: string | null; createdById?: string | null } = {}) {
  const v = value.startsWith("@") ? value.toLowerCase() : normalizeEmail(value);
  if (v.startsWith("@") && isSharedMailDomain(v)) throw new Error(`${v} is a shared email provider: add the person's address instead of the whole domain`);
  const entry = await db.emailSuppression.upsert({
    where: { value: v },
    create: { value: v, reason, note: o.note ?? null, campaignId: o.campaignId ?? null, createdById: o.createdById ?? null },
    update: {},
  });
  // Stop every campaign email still queued for them.
  if (!v.startsWith("@")) {
    await db.campaignRecipient.updateMany({
      where: { email: v, status: { in: ["QUEUED", "SENDING"] } },
      data: { status: reason === "bounce" ? "BOUNCED" : "UNSUBSCRIBED", nextSendAt: null, note: `Do-not-email list (${reason})` },
    });
  } else {
    await db.campaignRecipient.updateMany({
      where: { email: { endsWith: v }, status: { in: ["QUEUED", "SENDING"] } },
      data: { status: "UNSUBSCRIBED", nextSendAt: null, note: `Domain on the do-not-email list (${reason})` },
    });
  }
  return entry;
}
