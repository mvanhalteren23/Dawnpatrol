import "server-only";
import { randomUUID } from "node:crypto";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { connectedEmail, googleConnection } from "./google";
import { sendSms } from "./twilio";
import { busyIntervals, createEvent } from "./calendar";
import { candidateSlots, formatSlot, freeSlots, localDate, isoDate, parseWeeklyHours, pickSlots, type SlotRules } from "./booking";
import { recordActivity } from "./outreach";
import { normalizeDomain } from "./utils";

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
  };
}

const FALLBACK = "Live booking is unavailable right now. Collect two preferred days and times and tell the caller the team will confirm by text or email.";

async function ready(r: Receptionist): Promise<string | null> {
  if (!r.bookingEnabled) return "Booking is turned off for this receptionist. " + FALLBACK;
  if (!(await googleConnection()).connected) return FALLBACK;
  return null;
}

async function openSlots(r: Receptionist, now: Date) {
  const rules = slotRules(r);
  const busy = await busyIntervals(r.bookingCalendarId, now, new Date(now.getTime() + (rules.daysAhead + 1) * 86400_000));
  return { rules, slots: freeSlots(rules, now, busy) };
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
  return {
    ...base,
    available: true,
    slots: picked.slots.map((s) => ({ start_iso: s.toISOString(), label: formatSlot(s, r.timezone) })),
    message: `${date && !picked.matchedDate ? "Nothing open on the requested day. " : ""}Offer two or three of these times (all ${r.timezone}). Pass the chosen start_iso to book_appointment exactly as given.`,
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
  wants_text?: boolean | string;
  notes?: string;
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
  const wantsText = input.wants_text === true || input.wants_text === "true";

  // The slot must still be a valid opening (rules + calendar), so a stale or invented time can't book.
  const rules = slotRules(r);
  if (!candidateSlots(rules, now).some((s) => s.getTime() === start.getTime())) {
    return { booked: false, message: "That time isn't a bookable slot. Call get_available_times and offer one of its times." };
  }
  const { slots } = await openSlots(r, now);
  if (!slots.some((s) => s.getTime() === start.getTime())) {
    return { booked: false, message: "That time was just taken. Call get_available_times again and offer the caller new times." };
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
    `\nWants a text: ${wantsText ? "yes" : "no"}`,
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
  });

  if (r.bookingAddsToCrm) {
    await addLead(input, `${r.bookingTitle}: ${label}`, `${details}\n\nCalendar: ${event.htmlLink}`).catch((e) => console.error("Booking CRM lead failed", e));
  }

  let texted = false;
  if (wantsText) {
    const changeBy = [r.escalationPhone ? `call or text ${r.escalationPhone}` : "call us back", await connectedEmail()].filter(Boolean).join(" or email ");
    const how = meetingType === "google_meet" ? `Google Meet — the link is in your calendar invite${email ? ` (${email})` : ""}` : `we'll call you at ${input.caller_phone.trim()}`;
    const text = `${r.businessName}: you're booked for a ${r.bookingTitle.toLowerCase()} on ${label} (${r.bookingSlotMinutes} min, ${how}).${input.interest ? ` We'll cover: ${input.interest.trim()}.` : ""} To reschedule or cancel, ${changeBy}.`;
    texted = await sendSms(input.caller_phone, text).then(() => true, (e) => { console.error("Booking text failed", e); return false; });
  }

  return {
    booked: true,
    texted,
    start_iso: start.toISOString(),
    label,
    meet_link: event.meetLink,
    message: `Booked for ${label} (${r.timezone}). Read the time back to the caller${meetingType === "google_meet" ? " and tell them the Google Meet link is in their calendar invite" : email ? " and tell them a calendar invite is on its way to their email" : ""}${meetingType === "phone" ? `. We'll call them at ${input.caller_phone.trim()}` : ""}.${wantsText ? (texted ? " A confirmation text is on its way." : " The confirmation text couldn't be sent; tell them they'll get the details by email or a call instead.") : ""}`,
  };
}

/** Match an existing account by email domain or business name; otherwise create an inbound lead. */
async function addLead(input: BookingInput, subject: string, body: string) {
  const email = input.caller_email?.trim().toLowerCase() || null;
  const freeMail = /@(gmail|yahoo|hotmail|outlook|icloud|live|aol|proton|shaw|telus)\./i;
  const domain = email && !freeMail.test(email) ? normalizeDomain(email) : null;
  const name = input.business_name?.trim() || input.caller_name!.trim();

  let account =
    (email ? (await db.contact.findFirst({ where: { email }, include: { account: true } }))?.account : null) ??
    (domain ? await db.account.findUnique({ where: { domain } }) : null) ??
    (await db.account.findFirst({ where: { name: { equals: name, mode: "insensitive" } } }));
  if (!account) {
    account = await db.account.create({
      data: { name, domain, phone: input.caller_phone, industry: input.business_type ?? null, source: "inbound", notes: input.interest ?? "" },
    });
  }

  const [firstName, ...rest] = input.caller_name!.trim().split(/\s+/);
  let contact = await db.contact.findFirst({ where: { accountId: account.id, OR: [...(email ? [{ email }] : []), { phone: input.caller_phone }] } });
  if (!contact) {
    contact = await db.contact.create({
      data: { accountId: account.id, firstName, lastName: rest.join(" ") || null, email, phone: input.caller_phone, isPrimary: true },
    });
  }

  await recordActivity({ accountId: account.id, contactId: contact.id, type: "MEETING", direction: "INBOUND", subject, body, source: "receptionist" });
}
