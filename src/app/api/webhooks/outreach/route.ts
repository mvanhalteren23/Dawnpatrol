import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordActivity } from "@/lib/outreach";
import { verifySharedSecret } from "@/lib/webhook-verify";
import { normalizeDomain, websiteUrl } from "@/lib/utils";
import { researchNewAccounts } from "@/lib/jobs";

// Generic outreach webhook for sequencers / Zapier / Make. Accepts one event or an array.
//
// {
//   "id": "evt_123",                 // idempotency key (recommended)
//   "event": "email_sent" | "email_replied" | "email_opened" | "email_clicked" | "call" | "sms" | "linkedin" | "meeting_booked",
//   "email": "owner@acmeplumbing.com",
//   "company": "Acme Plumbing", "website": "acmeplumbing.com",   // used if the lead isn't in the CRM yet
//   "firstName": "Bob", "lastName": "Smith", "title": "Owner",
//   "subject": "...", "body": "...", "occurredAt": "2026-10-01T15:00:00Z",
//   "createIfMissing": true
// }

type OutreachEvent = {
  id?: string;
  event: string;
  email?: string;
  company?: string;
  website?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  subject?: string;
  body?: string;
  occurredAt?: string;
  createIfMissing?: boolean;
};

const MAP: Record<string, { type: string; direction: "OUTBOUND" | "INBOUND" } | "open" | "click"> = {
  email_sent: { type: "EMAIL", direction: "OUTBOUND" },
  email_replied: { type: "EMAIL", direction: "INBOUND" },
  reply: { type: "EMAIL", direction: "INBOUND" },
  email_opened: "open",
  email_clicked: "click",
  call: { type: "CALL", direction: "OUTBOUND" },
  call_inbound: { type: "CALL", direction: "INBOUND" },
  sms: { type: "SMS", direction: "OUTBOUND" },
  sms_reply: { type: "SMS", direction: "INBOUND" },
  linkedin: { type: "LINKEDIN", direction: "OUTBOUND" },
  linkedin_reply: { type: "LINKEDIN", direction: "INBOUND" },
  meeting_booked: { type: "MEETING", direction: "INBOUND" },
};

async function resolve(e: OutreachEvent) {
  const email = e.email?.toLowerCase().trim();
  if (email) {
    const contact = await db.contact.findFirst({ where: { email } });
    if (contact) return { accountId: contact.accountId, contactId: contact.id };
  }
  const domain = normalizeDomain(e.website) ?? normalizeDomain(email);
  let account = domain ? await db.account.findUnique({ where: { domain } }) : null;
  if (!account && e.createIfMissing && (e.company || domain)) {
    account = await db.account.create({ data: { name: e.company ?? domain!, domain, website: websiteUrl(e.website ?? domain), source: "inbound", tags: "webhook" } });
    await researchNewAccounts([account.id]);
  }
  if (!account) return null;
  let contactId: string | null = null;
  if (email) {
    const c = await db.contact.create({ data: { accountId: account.id, email, firstName: e.firstName ?? null, lastName: e.lastName ?? null, title: e.title ?? null } });
    contactId = c.id;
  }
  return { accountId: account.id, contactId };
}

// New accounts are researched after the response.
export const maxDuration = 300;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const given = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
  if (!verifySharedSecret(given, process.env.OUTREACH_WEBHOOK_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = (await req.json()) as OutreachEvent | OutreachEvent[];
  const events = Array.isArray(json) ? json.slice(0, 500) : [json];
  const results: { id?: string; status: string }[] = [];

  for (const e of events) {
    const mapped = MAP[e.event];
    if (!mapped) {
      results.push({ id: e.id, status: `unknown event ${e.event}` });
      continue;
    }
    const target = await resolve(e);
    if (!target) {
      results.push({ id: e.id, status: "no matching account" });
      continue;
    }
    if (mapped === "open" || mapped === "click") {
      const last = await db.activity.findFirst({
        where: { accountId: target.accountId, type: "EMAIL", direction: "OUTBOUND", ...(target.contactId ? { contactId: target.contactId } : {}) },
        orderBy: { occurredAt: "desc" },
      });
      if (last) {
        await db.activity.update({
          where: { id: last.id },
          data: mapped === "open" ? { openCount: { increment: 1 }, firstOpenedAt: last.firstOpenedAt ?? new Date() } : { clickCount: { increment: 1 } },
        });
      }
      results.push({ id: e.id, status: last ? "updated" : "no email to attach to" });
      continue;
    }
    const created = await recordActivity({
      accountId: target.accountId,
      contactId: target.contactId,
      type: mapped.type,
      direction: mapped.direction,
      subject: e.subject ?? e.event.replace(/_/g, " "),
      body: e.body ?? null,
      source: "webhook",
      externalId: e.id ? `webhook:${e.id}` : null,
      occurredAt: e.occurredAt ? new Date(e.occurredAt) : undefined,
    });
    results.push({ id: e.id, status: created ? "recorded" : "duplicate" });
  }
  return NextResponse.json({ results });
}
