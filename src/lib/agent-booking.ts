import "server-only";
import { randomUUID } from "node:crypto";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { connectedEmail, googleConnection } from "./google";
import { busyIntervals, createEvent } from "./calendar";
import { candidateSlots, closedDates, formatSlot, freeSlots, localDate, isoDate, parseWeeklyHours, pickSlots, type SlotRules } from "./booking";
import { recordActivity } from "./outreach";
import { normalizeDomain } from "./utils";
import { samePhone, toE164 } from "./twilio";
import { deleteEvent } from "./calendar";
import { normalizeBusinessName } from "./business-names";
import { findAccountIdByPhone } from "./team";
import { followUpEnabled, pickChannel, sendFollowUp } from "./follow-up";
import { queueProfileResearch } from "./jobs";

// Server side of the receptionist's two booking tools (get_available_times, book_appointment).
// Responses are phrased for the agent to read: every branch returns a `message` it can act on.

export function slotRules(r: Receptionist): SlotRules {
  return {
    timezone: r.timezone,
    hours: parseWeeklyHours(r.bookingHours),
    slotMinutes: r.bookingSlotMinutes,
    minNoticeHours: r.bookingMinNoticeHours,
    daysAhead: r.bookingDaysAhead,
    bufferMinutes: r.bookingBufferMinutes,
    closedDates: closedDates(r.bookingHolidays, r.bookingClosedDates, new Date().getUTCFullYear()),
  };
}

const FALLBACK = "Live booking is unavailable right now. Collect two preferred days and times and tell the caller the team will confirm by text or email.";

async function ready(r: Receptionist): Promise<string | null> {
  if (!r.bookingEnabled) return "Booking is turned off for this receptionist. " + FALLBACK;
  if (!(await googleConnection(r.googleUserId)).connected) return FALLBACK;
  return null;
}

async function openSlots(r: Receptionist, now: Date) {
  const rules = slotRules(r);
  const busy = await busyIntervals(r.bookingCalendarId, now, new Date(now.getTime() + (rules.daysAhead + 1) * 86400_000), r.googleUserId);
  return { rules, slots: freeSlots(rules, now, busy) };
}

/** Every open slot in the booking window (the public booking page lists them by day). */
export async function openings(r: Receptionist, now = new Date()): Promise<{ ready: boolean; slots: Date[]; message?: string }> {
  const notReady = await ready(r);
  if (notReady) return { ready: false, slots: [], message: notReady };
  return { ready: true, slots: (await openSlots(r, now)).slots };
}

/** A rescheduled booking: cancel the old one and take it off the calendar. */
async function cancelReplaced(r: Receptionist, oldId: string) {
  const old = await db.booking.findUnique({ where: { id: oldId } });
  if (!old || old.receptionistId !== r.id || ["CANCELLED", "NO_SHOW"].includes(old.status)) return;
  await db.booking.update({ where: { id: old.id }, data: { status: "CANCELLED" } });
  if (old.eventId) await deleteEvent(old.calendarId, old.eventId, old.googleUserId);
}

export async function availability(r: Receptionist, input: { preferred_date?: string; time_of_day?: string }, now = new Date()) {
  const notReady = await ready(r);
  if (notReady) return { available: false, message: notReady };
  const { slots } = await openSlots(r, now);
  const today = localDate(now, r.timezone);
  const base = { timezone: r.timezone, today: `${isoDate(today.y, today.m, today.d)} (${formatSlot(now, r.timezone).split(" at ")[0]})` };
  if (!slots.length) return { ...base, available: false, slots: [], message: `No openings in the next ${r.bookingDaysAhead} days. ${FALLBACK}` };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.preferred_date ?? "") ? input.preferred_date : undefined;
  const picked = pickSlots(slots, r.timezone, { date, timeOfDay: input.time_of_day });
  const last = localDate(slots[slots.length - 1]!, r.timezone);
  const beyond = date && date > isoDate(last.y, last.m, last.d);
  const why = date && !picked.matchedDate
    ? beyond ? `Bookings only open ${r.bookingDaysAhead} days ahead, so that day can't be booked yet. Here are the nearest times. `
      : "Nothing open on the requested day. "
    : "";
  return {
    ...base,
    available: true,
    slots: picked.slots.map((s) => ({ start_iso: s.toISOString(), label: formatSlot(s, r.timezone) })),
    message: `${why}Offer two or three of these times (all ${r.timezone}). Pass the chosen start_iso to book_appointment exactly as given.`,
  };
}

export type BookingInput = {
  start_iso?: string;
  meeting_type?: string;
  caller_name?: string;
  caller_phone?: string;
  caller_email?: string;
  business_name?: string;
  business_type?: string;
  interest?: string;
  answers?: string;
  summary_method?: string; // text | email | none
  wants_text?: boolean | string; // older agents
  conversation_id?: string;
  notes?: string;
  source?: "call" | "link"; // the public booking link books through here too
  replaces_id?: string; // a booking being rescheduled through the link
};

/** The caller picks when the receptionist allows either; otherwise the receptionist's setting wins. */
export function meetingTypeFor(setting: string, requested?: string): "phone" | "google_meet" {
  if (setting === "caller_choice") return requested === "google_meet" ? "google_meet" : "phone";
  return setting === "google_meet" ? "google_meet" : "phone";
}

export async function book(r: Receptionist, input: BookingInput, now = new Date()) {
  const notReady = await ready(r);
  if (notReady) return { booked: false, message: notReady };
  const start = new Date(input.start_iso ?? "");
  if (Number.isNaN(start.getTime())) return { booked: false, message: "start_iso is missing or invalid. Call get_available_times and use one of its start_iso values." };
  if (!input.caller_name?.trim() || !input.caller_phone?.trim()) return { booked: false, message: "Ask for the caller's name and best phone number before booking." };
  const meetingType = meetingTypeFor(r.bookingMeetingType, input.meeting_type);
  const email = input.caller_email?.includes("@") ? input.caller_email.trim() : null;
  if (meetingType === "google_meet" && !email) return { booked: false, message: "A Google Meet needs the caller's email for the invite. Ask for it (spell it back), then book again." };
  const preference = input.summary_method ?? (input.wants_text === true || input.wants_text === "true" ? "text" : input.wants_text != null ? "none" : null);
  const channel = followUpEnabled(r, "booking") ? pickChannel(r.followUpChannel, preference, input.caller_phone.trim(), email) : null;

  // The slot must still be a valid opening (rules + calendar), so a stale or invented time can't book.
  const { rules, slots } = await openSlots(r, now);
  if (!slots.some((s) => s.getTime() === start.getTime())) {
    // Only on a miss: work out whether it was never a valid slot or was just taken.
    const valid = candidateSlots(rules, now).some((s) => s.getTime() === start.getTime());
    return {
      booked: false,
      message: valid
        ? "That time was just taken. Call get_available_times again and offer the caller new times."
        : "That time isn't a bookable slot. Call get_available_times and offer one of its times.",
    };
  }

  const end = new Date(start.getTime() + r.bookingSlotMinutes * 60_000);
  const label = formatSlot(start, r.timezone);
  const who = input.business_name?.trim() ? `${input.caller_name.trim()} (${input.business_name.trim()})` : input.caller_name.trim();
  const details = [
    `Booked by ${r.name}, the AI receptionist, during a phone call.`,
    `Caller: ${input.caller_name.trim()}`,
    `Phone: ${input.caller_phone.trim()}`,
    input.caller_email ? `Email: ${input.caller_email.trim()}` : null,
    input.business_name ? `Business: ${input.business_name.trim()}` : null,
    input.business_type ? `Business type: ${input.business_type.trim()}` : null,
    input.interest ? `Interested in: ${input.interest.trim()}` : null,
    input.answers?.trim() ? `\nBefore the call:\n${input.answers.trim()}` : null,
    `\nConfirmation: ${channel === "sms" ? "by text" : channel === "email" ? "by email" : "none requested"}`,
    input.notes ? `Notes: ${input.notes.trim()}` : null,
    meetingType === "phone" ? `\nCall them at ${input.caller_phone.trim()}.` : "\nGoogle Meet (link in the invite).",
  ].filter(Boolean).join("\n");

  const event = await createEvent({
    calendarId: r.bookingCalendarId,
    start,
    end,
    timezone: r.timezone,
    summary: `${r.bookingTitle} — ${who}`,
    description: details,
    attendeeEmail: email,
    googleMeet: meetingType === "google_meet",
    requestId: randomUUID(),
    as: r.googleUserId,
  });

  // Every booking is recorded: reminders, no-show rebooking and review requests run from it.
  await db.booking.create({
    data: {
      receptionistId: r.id,
      eventId: event.id,
      calendarId: r.bookingCalendarId,
      googleUserId: r.googleUserId,
      start,
      end,
      timezone: r.timezone,
      title: r.bookingTitle,
      customerName: input.caller_name.trim(),
      customerPhone: toE164(input.caller_phone.trim()) || input.caller_phone.trim(),
      customerEmail: email,
      source: input.source ?? "call",
      replacesId: input.replaces_id || null,
    },
  });
  if (input.replaces_id) await cancelReplaced(r, input.replaces_id).catch((e) => console.error("replace booking", e));

  let lead: LeadResult | null = null;
  if (r.bookingAddsToCrm) {
    lead = await addLead(r, input, label, `${r.bookingTitle}: ${label}`, `${details}\n\nCalendar: ${event.htmlLink}`).catch((e) => {
      console.error("Booking CRM lead failed", e);
      return null;
    });
  }

  let sent = false;
  if (channel) {
    const changeBy = [r.escalationPhone ? `call or text ${r.escalationPhone}` : "call us back", await connectedEmail(r.googleUserId)].filter(Boolean).join(" or email ");
    const how = meetingType === "google_meet" ? `Google Meet — the link is in your calendar invite${email ? ` (${email})` : ""}` : `we'll call you at ${input.caller_phone.trim()}`;
    const topic = input.interest ? ` We'll cover: ${input.interest.trim()}.` : "";
    const body = channel === "sms"
      ? `${r.businessName}: you're booked for a ${r.bookingTitle.toLowerCase()} on ${label} (${r.bookingSlotMinutes} min, ${how}).${topic} To reschedule or cancel, ${changeBy}.`
      : [
          `Hi ${input.caller_name.trim().split(/\s+/)[0]},`,
          "",
          `You're booked for a ${r.bookingTitle.toLowerCase()} with ${r.businessName}:`,
          "",
          `When: ${label} (${r.timezone.replace("America/", "").replace("_", " ")} time), ${r.bookingSlotMinutes} minutes`,
          `How: ${meetingType === "google_meet" ? "Google Meet — the link is in your calendar invite" : `we'll call you at ${input.caller_phone.trim()}`}`,
          ...(input.interest ? [`About: ${input.interest.trim()}`] : []),
          "",
          `Need to reschedule or cancel? No problem — ${changeBy}.`,
          "",
          `The ${r.businessName} team`,
        ].join("\n");
    sent = await sendFollowUp(r, {
      kind: "booking",
      channel,
      to: channel === "sms" ? input.caller_phone.trim() : email!,
      subject: `Booked: ${r.bookingTitle} on ${label}`,
      body,
      conversationId: input.conversation_id || null,
    });
  }

  return {
    booked: true,
    confirmation: channel ? (sent ? `sent by ${channel === "sms" ? "text" : "email"}` : "failed") : "none",
    researchRunId: lead?.researchRunId ?? null,
    start_iso: start.toISOString(),
    label,
    meet_link: event.meetLink,
    message: `Booked for ${label} (${r.timezone}). Read the time back to the caller${meetingType === "google_meet" ? " and tell them the Google Meet link is in their calendar invite" : email ? " and tell them a calendar invite is on its way to their email" : ""}${meetingType === "phone" ? `. We'll call them at ${input.caller_phone.trim()}` : ""}.${channel ? (sent ? ` A confirmation ${channel === "sms" ? "text" : "email"} is on its way.` : " The confirmation couldn't be sent; tell them the team will follow up with the details.") : ""}`,
  };
}

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|shaw|telus|rogers|sympatico|bell)\./i;

export { normalizeBusinessName };

type AccountRow = NonNullable<Awaited<ReturnType<typeof db.account.findUnique>>>;

/**
 * Find a caller's account: contact email, then company email domain, then phone, then business
 * name. Used when booking and by the personalization and client-message tools.
 */
export async function matchAccount(input: { email?: string | null; phone?: string | null; businessName?: string | null }): Promise<{ account: AccountRow | null; matchedBy: string | null }> {
  const email = input.email?.includes("@") ? input.email.trim().toLowerCase() : null;
  const domain = email && !FREE_MAIL.test(email) ? normalizeDomain(email) : null;
  const phone = input.phone?.trim() || null;
  const businessName = input.businessName?.trim() || null;
  let matchedBy: string | null = null;
  let account: AccountRow | null = email ? (await db.contact.findFirst({ where: { email }, include: { account: true } }))?.account ?? null : null;
  if (account) matchedBy = `contact email (${email})`;
  if (!account && domain) {
    account = await db.account.findUnique({ where: { domain } });
    if (account) matchedBy = `email domain (${domain})`;
  }
  if (!account) {
    const id = phone ? await findAccountIdByPhone(phone) : null;
    account = id ? await db.account.findUnique({ where: { id } }) : null;
    if (account) matchedBy = `phone number (${phone})`;
  }
  if (!account && businessName) {
    const key = normalizeBusinessName(businessName);
    const candidates = await db.account.findMany({ where: { name: { contains: key.split(" ")[0] ?? key, mode: "insensitive" } } });
    account = candidates.find((a) => normalizeBusinessName(a.name) === key) ?? null;
    if (account) matchedBy = `business name (${businessName})`;
  }

  return { account, matchedBy };
}

type LeadResult = { accountId: string; created: boolean; researchRunId: string | null };

/**
 * Find the caller's account (contact email → company email domain → phone → business name),
 * or create one. Logs the booking, flags the account for review, and queues Claude research when
 * the account is new or has never been researched. The caller runs the research after responding.
 */
async function addLead(r: Receptionist, input: BookingInput, label: string, subject: string, body: string): Promise<LeadResult> {
  const email = input.caller_email?.trim().toLowerCase() || null;
  const domain = email && !FREE_MAIL.test(email) ? normalizeDomain(email) : null;
  const phone = input.caller_phone!.trim();
  const businessName = input.business_name?.trim() || null;
  const name = businessName || input.caller_name!.trim();

  const match = await matchAccount({ email, phone, businessName });
  let account = match.account;
  const matchedBy = match.matchedBy;

  const created = !account;
  if (!account) {
    const notes = [
      `Created from a call booked by ${r.name} (${r.businessName}'s receptionist) for ${label}.`,
      input.business_type ? `Business type: ${input.business_type.trim()}` : null,
      input.interest ? `Interested in: ${input.interest.trim()}` : null,
      input.answers?.trim() ? `From the call:\n${input.answers.trim()}` : null,
    ].filter(Boolean).join("\n");
    account = await db.account.create({
      data: { name, domain, website: domain ? `https://${domain}` : null, phone, industry: input.business_type?.trim() || null, source: "inbound", notes },
    });
  }

  const [firstName, ...rest] = input.caller_name!.trim().split(/\s+/);
  const contacts = await db.contact.findMany({ where: { accountId: account.id } });
  let contact = contacts.find((c) => (email && c.email?.toLowerCase() === email) || samePhone(c.phone, phone)) ?? null;
  if (contact) {
    contact = await db.contact.update({ where: { id: contact.id }, data: { email: contact.email ?? email, phone: contact.phone ?? phone } });
  } else {
    contact = await db.contact.create({
      data: { accountId: account.id, firstName, lastName: rest.join(" ") || null, email, phone, isPrimary: contacts.length === 0 },
    });
  }

  await recordActivity({ accountId: account.id, contactId: contact.id, type: "MEETING", direction: "INBOUND", subject, body, source: "receptionist" });

  const reviewReason = created
    ? `New account: ${r.name} booked ${label} and created this account from the call. The business is being researched automatically (verified facts only) to fill in the details. Check them and edit as needed.`
    : `${r.name} booked ${label} and matched the caller to this account by ${matchedBy}. Check the match and the contact details.`;
  await db.account.update({ where: { id: account.id }, data: { needsReview: true, reviewReason } });

  // New accounts get a fact-only profile; matched ones only if they were never researched.
  const researched = created ? 0 : await db.researchRun.count({ where: { accountId: account.id, kind: "RESEARCH", status: { in: ["DONE", "RUNNING"] } } });
  const researchRunId = researched ? null : await queueProfileResearch(account.id);
  return { accountId: account.id, created, researchRunId };
}
