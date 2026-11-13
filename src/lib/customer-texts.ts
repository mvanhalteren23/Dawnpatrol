import "server-only";
import { randomBytes } from "node:crypto";
import type { Booking, CallLog, Receptionist } from "@prisma/client";
import { db } from "./db";
import { appUrl } from "./app-url";
import { sendSms, toE164 } from "./twilio";
import { aiConfigured } from "./ai";
import { compileKnowledgeBase } from "./rag";
import { leadAlertNumbers } from "./follow-up";
import { googleConnection } from "./google";
import {
  bookingLinkUrl, isConfirm, isReschedule, noShowText, reminderDue, reminderText, rescheduleText, rescueText, rescueWanted, reviewDue, reviewText,
} from "./customer-text-rules";

// Texts to a client's customers (wording and timing in customer-text-rules.ts):
//   rescue   - a call ended without a booking: a booking link, within a minute
//   chat     - the customer texts the business line: the AI answers from the knowledge base
//   reminder - the day before an appointment; reply C confirms, R gets the link to move it
//   noshow   - the owner marks a no-show: a link to rebook
//   review   - after the appointment: the Google review link (everyone; replies go to the owner)
// Everything is logged in SmsMessage (both ways) and respects STOP.

type R = Receptionist;

/** Only a client's live agent texts its customers (not demos, the builder or our own line). */
export function textsCustomers(r: Pick<R, "lifecycle" | "agentType" | "bookingAddsToCrm" | "demoExtension">): boolean {
  return r.lifecycle === "production" && r.agentType === "inbound" && !r.bookingAddsToCrm;
}

export async function ensureBookingKey(r: Pick<R, "id" | "bookingKey">): Promise<string> {
  if (r.bookingKey) return r.bookingKey;
  const key = randomBytes(9).toString("base64url");
  await db.receptionist.update({ where: { id: r.id }, data: { bookingKey: key } });
  return key;
}

/** The public booking link, when this receptionist books (its own Google calendar, ours, or the CRM's). */
export async function bookingLink(r: R, replaces?: string | null): Promise<string | null> {
  if (!r.bookingEnabled) return null;
  return bookingLinkUrl(appUrl(), await ensureBookingKey(r), replaces);
}

async function optedOut(r: Pick<R, "id">, phone: string): Promise<boolean> {
  return Boolean(await db.smsOptOut.findUnique({ where: { receptionistId_phone: { receptionistId: r.id, phone } } }));
}

/** Send one text to a customer from the business line (or the shared number), and log it. */
export async function textCustomer(r: R, phoneRaw: string, body: string, kind: string, bookingId?: string | null): Promise<boolean> {
  const phone = toE164(phoneRaw);
  if (!phone || (await optedOut(r, phone))) return false;
  try {
    await sendSms(phone, body, r.businessNumber);
  } catch (err) {
    console.error(`customer text (${kind}) failed`, err);
    return false;
  }
  await db.smsMessage.create({ data: { receptionistId: r.id, phone, direction: "OUT", kind, body, bookingId: bookingId ?? null } });
  return true;
}

export async function alertOwner(r: R, body: string) {
  const to = leadAlertNumbers(r)[0] ?? r.ringFirstNumber ?? r.escalationPhone;
  if (!to) return;
  await sendSms(to, body.slice(0, 600), r.businessNumber).catch((e) => console.error("owner alert text failed", e));
}

// --- #1 Missed-opportunity rescue ---------------------------------------------------------

/** After a call is logged: no booking, but they wanted something. One text, within two hours of the call. */
export async function rescueAfterCall(r: R, call: CallLog, collected: Record<string, { value?: unknown }>) {
  if (!r.rescueTextsOn || !textsCustomers(r) || !rescueWanted(call.outcome)) return;
  if (Date.now() - call.startedAt.getTime() > 2 * 3600_000) return; // a backfill sync never texts old callers
  const given = collected.callback_number?.value;
  const phone = toE164(typeof given === "string" && given.trim() ? given : call.callerNumber ?? "");
  if (!phone) return;
  // One text per call: skip if a summary already went out, or they booked since, or we rescued them today.
  const since = new Date(Date.now() - 12 * 3600_000);
  const [summary, booked, rescued] = await Promise.all([
    db.followUpMessage.findFirst({ where: { receptionistId: r.id, conversationId: call.externalId } }),
    db.booking.findFirst({ where: { receptionistId: r.id, customerPhone: phone, createdAt: { gte: call.startedAt } } }),
    db.smsMessage.findFirst({ where: { receptionistId: r.id, phone, kind: "rescue", createdAt: { gte: since } } }),
  ]);
  if (summary || booked || rescued) return;
  await textCustomer(r, phone, rescueText({ businessName: r.businessName, callerName: call.callerName, bookingLink: await bookingLink(r) }), "rescue");
}

// --- #2 Texts in ------------------------------------------------------------------------------

/**
 * A customer texted the business line. Replies to a reminder (C / R) are handled; feedback after a
 * review request goes to the owner; anything else gets an AI answer from the knowledge base
 * (forwarded to the owner when it needs them). Returns the slow AI part to run after responding.
 */
export async function handleCustomerText(r: R, fromRaw: string, body: string): Promise<{ reply: string | null; background: (() => Promise<void>) | null }> {
  const from = toE164(fromRaw);
  await db.smsMessage.create({ data: { receptionistId: r.id, phone: from, direction: "IN", kind: "chat", body: body.slice(0, 1600) } });
  const lastOut = await db.smsMessage.findFirst({ where: { receptionistId: r.id, phone: from, direction: "OUT", createdAt: { gte: new Date(Date.now() - 72 * 3600_000) } }, orderBy: { createdAt: "desc" } });

  if (lastOut?.kind === "reminder" && lastOut.bookingId) {
    const booking = await db.booking.findUnique({ where: { id: lastOut.bookingId } });
    if (booking && isConfirm(body)) {
      await db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
      return { reply: await logReply(r, from, "Thanks, you're confirmed. See you then!", "reminder", booking.id), background: null };
    }
    if (booking && isReschedule(body)) {
      await db.booking.update({ where: { id: booking.id }, data: { status: "RESCHEDULE_REQUESTED" } });
      await alertOwner(r, `${r.businessName}: ${booking.customerName} wants to move their ${booking.title.toLowerCase()} (${booking.start.toLocaleString("en-US", { timeZone: booking.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}). They've been sent the booking link.`);
      return { reply: await logReply(r, from, rescheduleText({ bookingLink: await bookingLink(r, booking.id), businessName: r.businessName }), "reminder", booking.id), background: null };
    }
  }

  if (lastOut?.kind === "review") {
    await alertOwner(r, `${r.businessName} review follow-up from ${from}: "${body.slice(0, 400)}"`);
    return { reply: await logReply(r, from, "Thank you for letting us know. We've passed it on to the team.", "review"), background: null };
  }

  if (!r.smsAgentOn || !aiConfigured()) {
    await alertOwner(r, `Text to ${r.businessName} from ${from}: ${body}`);
    return { reply: null, background: null };
  }
  return {
    reply: null,
    background: async () => {
      try {
        const { smsReply } = await import("./ai");
        const items = await db.knowledgeItem.findMany({ where: { receptionistId: r.id } });
        const history = (await db.smsMessage.findMany({ where: { receptionistId: r.id, phone: from, createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } }, orderBy: { createdAt: "asc" }, take: 20 }))
          .map((m) => ({ role: m.direction === "IN" ? ("user" as const) : ("assistant" as const), content: m.body }));
        const out = await smsReply({ businessName: r.businessName, agentName: r.name, timezone: r.timezone, knowledgeBase: compileKnowledgeBase(items, r.businessName), history, bookingLink: await bookingLink(r) });
        if (out.reply) await textCustomer(r, from, out.reply, "chat");
        if (out.needsOwner) await alertOwner(r, `Text to ${r.businessName} from ${from}: "${body.slice(0, 300)}"${out.ownerNote ? `\n${out.ownerNote}` : ""}\nReplied: "${out.reply.slice(0, 200)}"`);
      } catch (err) {
        console.error("text agent failed", err);
        await alertOwner(r, `Text to ${r.businessName} from ${from} (the assistant couldn't reply): ${body.slice(0, 400)}`);
      }
    },
  };
}

async function logReply(r: R, phone: string, body: string, kind: string, bookingId?: string): Promise<string> {
  await db.smsMessage.create({ data: { receptionistId: r.id, phone, direction: "OUT", kind, body, bookingId: bookingId ?? null } });
  return body;
}

/** A text to the shared number (clients without a business line): the client whose texts it answers. */
export async function receptionistForSharedText(fromRaw: string): Promise<R | null> {
  const last = await db.smsMessage.findFirst({ where: { phone: toE164(fromRaw), direction: "OUT", createdAt: { gte: new Date(Date.now() - 14 * 86400_000) } }, orderBy: { createdAt: "desc" }, include: { receptionist: true } });
  return last && !last.receptionist.businessNumber ? last.receptionist : null;
}

// --- #4 Reminders, no-shows; #17 reviews ---------------------------------------------------------

/** Every 30 minutes in the day (and the daily backstop): send reminders and review requests that are due. */
export async function processCustomerTexts(now = new Date()): Promise<{ reminders: number; reviews: number }> {
  let reminders = 0;
  let reviews = 0;
  const upcoming = await db.booking.findMany({
    where: { status: { in: ["BOOKED", "CONFIRMED"] }, reminderSentAt: null, customerPhone: { not: null }, start: { gte: new Date(now.getTime() + 12 * 3600_000), lte: new Date(now.getTime() + 36 * 3600_000) } },
    include: { receptionist: true },
    take: 200,
  });
  for (const b of upcoming) {
    const r = b.receptionist;
    if (!r.remindersOn || !textsCustomers(r) || !reminderDue(b, now)) continue;
    // Claim first, so two overlapping runs can't both text.
    const claimed = await db.booking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    if (await textCustomer(r, b.customerPhone!, reminderText({ businessName: r.businessName, customerName: b.customerName, title: b.title, start: b.start, timezone: b.timezone }), "reminder", b.id)) reminders++;
  }

  const finished = await db.booking.findMany({
    where: { status: { in: ["BOOKED", "CONFIRMED"] }, reviewAskedAt: null, customerPhone: { not: null }, end: { gte: new Date(now.getTime() - 3 * 86400_000), lte: now }, receptionist: { reviewRequestsOn: true, reviewLink: { not: "" } } },
    include: { receptionist: true },
    take: 200,
  });
  for (const b of finished) {
    const r = b.receptionist;
    if (!textsCustomers(r) || !reviewDue(b, r.reviewDelayHours, now)) continue;
    // Once per customer every 90 days, however many visits.
    const recent = await db.smsMessage.findFirst({ where: { receptionistId: r.id, phone: toE164(b.customerPhone!), kind: "review", direction: "OUT", createdAt: { gte: new Date(now.getTime() - 90 * 86400_000) } } });
    const claimed = await db.booking.updateMany({ where: { id: b.id, reviewAskedAt: null }, data: { reviewAskedAt: now } });
    if (!claimed.count || recent) continue;
    if (await textCustomer(r, b.customerPhone!, reviewText({ businessName: r.businessName, customerName: b.customerName, reviewLink: r.reviewLink }), "review", b.id)) reviews++;
  }
  return { reminders, reviews };
}

/** The owner marks a no-show: the customer gets a friendly text with a link to rebook. */
export async function markNoShow(b: Booking & { receptionist: R }): Promise<{ texted: boolean }> {
  await db.booking.update({ where: { id: b.id }, data: { status: "NO_SHOW", noShowTextAt: new Date() } });
  const r = b.receptionist;
  if (!r.remindersOn || !b.customerPhone || !textsCustomers(r)) return { texted: false };
  const texted = await textCustomer(r, b.customerPhone, noShowText({ businessName: r.businessName, customerName: b.customerName, bookingLink: await bookingLink(r) }), "noshow", b.id);
  return { texted };
}
