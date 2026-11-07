import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { googleConnection, type GoogleAs } from "./google";
import { busyIntervals, createEvent, deleteEvent } from "./calendar";
import type { Interval } from "./booking";

// Where a receptionist's bookings live:
// - "client": the client connected their own Google Calendar in the portal. The receptionist checks
//   it for busy times and books into it, so invites come from the client's own calendar.
// - "google": a Google calendar connected in the CRM. Our own line, demos (the rep's calendar), and
//   clients who shared a calendar with the company account (a calendar id other than "primary").
// - "crm": nothing to set up. Bookings live in the CRM: availability is the business hours minus
//   existing bookings and blocked time, and confirmations carry an "add to calendar" file.

export type CalendarMode = "client" | "google" | "crm";
export type BookingCalendar = { mode: CalendarMode; as: GoogleAs; calendarId: string; email: string | null; fallbackFrom?: string | null };

const LIVE_KEY = "calendar.connectLive";

/**
 * Whether clients are offered "Connect Google Calendar" (Level 3). Off until Google approves the
 * calendar app (CRM → Settings); until then every client line uses the built-in calendar (Level 0).
 */
export async function calendarConnectLive(): Promise<boolean> {
  const { getSetting } = await import("./settings");
  return (await getSetting(LIVE_KEY).catch(() => null)) === "on";
}

export async function setCalendarConnectLive(on: boolean) {
  const { setSetting } = await import("./settings");
  await setSetting(LIVE_KEY, on ? "on" : "");
}

const TESTERS_KEY = "calendar.connectTesters";

/** Client logins that can connect before Google approves (e.g. for the verification video). */
export async function calendarConnectTesters(): Promise<string[]> {
  const { getSetting } = await import("./settings");
  return ((await getSetting(TESTERS_KEY).catch(() => null)) ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

export async function setCalendarConnectTesters(emails: string[]) {
  const { setSetting } = await import("./settings");
  await setSetting(TESTERS_KEY, Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))).join(","));
}

/** Whether this client login is offered "Connect Google Calendar": everyone once approved, test clients before. */
export async function calendarConnectAllowedFor(email: string | null | undefined): Promise<boolean> {
  if (await calendarConnectLive()) return true;
  return Boolean(email) && (await calendarConnectTesters()).includes(email!.toLowerCase());
}

/** The client's calendar stopped working: note it, so bookings fall back to the built-in calendar. */
export async function markClientCalendarBroken(receptionistId: string, err: unknown) {
  const marked = await db.clientCalendar.updateMany({ where: { receptionistId, lastError: null }, data: { lastError: String((err as Error)?.message ?? err).slice(0, 300) } }).catch(() => ({ count: 0 }));
  if (!marked.count) return;
  // Once: a note on the account, so the team can ask the client to reconnect.
  const r = await db.receptionist.findUnique({ where: { id: receptionistId }, select: { accountId: true, name: true } });
  if (r) {
    const { recordActivity } = await import("./outreach");
    await recordActivity({ accountId: r.accountId, type: "NOTE", source: "system", subject: "Google Calendar connection stopped working", body: `${r.name} couldn't reach the client's Google Calendar, so bookings are using the built-in calendar until they reconnect it (portal → Your setup → Connect Google Calendar).` }).catch(() => undefined);
  }
}

type R = Pick<Receptionist, "id" | "googleUserId" | "bookingCalendarId" | "lifecycle" | "bookingAddsToCrm" | "agentType">;

export async function calendarFor(r: R): Promise<BookingCalendar> {
  const client = await db.clientCalendar.findUnique({ where: { receptionistId: r.id } });
  // A connection that stopped working falls back to the built-in calendar until it's reconnected.
  if (client && !client.lastError) return { mode: "client", as: `cal:${r.id}`, calendarId: client.calendarId, email: client.email };
  // Our own lines and demos book into the company or rep's Google calendar, as before; so does a
  // client whose own calendar was shared with the company account.
  const ours = r.bookingAddsToCrm || r.lifecycle === "demo" || r.agentType !== "inbound" || Boolean(r.googleUserId) || r.bookingCalendarId !== "primary";
  if (ours) {
    const g = await googleConnection(r.googleUserId);
    if (g.connected && g.calendar) return { mode: "google", as: r.googleUserId, calendarId: r.bookingCalendarId, email: g.email };
  }
  return { mode: "crm", as: null, calendarId: "crm", email: null, fallbackFrom: client?.lastError ? client.email : null };
}

export const BUILT_IN: BookingCalendar = { mode: "crm", as: null, calendarId: "crm", email: null };

/** Busy time between `from` and `to`: from Google, or the CRM's own bookings and blocks. */
export async function busyFor(r: R, cal: BookingCalendar, from: Date, to: Date): Promise<Interval[]> {
  if (cal.mode !== "crm") return busyIntervals(cal.calendarId, from, to, cal.as);
  const [bookings, blocks] = await Promise.all([
    db.booking.findMany({ where: { receptionistId: r.id, status: { notIn: ["CANCELLED"] }, start: { lt: to }, end: { gt: from } }, select: { start: true, end: true } }),
    db.calendarBlock.findMany({ where: { receptionistId: r.id, start: { lt: to }, end: { gt: from } }, select: { start: true, end: true } }),
  ]);
  return [...bookings, ...blocks].map((b) => ({ start: b.start, end: b.end }));
}

/** Put a booking on the calendar. In the CRM calendar there's no outside event (the Booking row is it). */
export async function placeBooking(cal: BookingCalendar, e: Omit<Parameters<typeof createEvent>[0], "calendarId" | "as">): Promise<{ id: string | null; htmlLink: string | null; meetLink: string | null }> {
  if (cal.mode === "crm") return { id: null, htmlLink: null, meetLink: null };
  return createEvent({ ...e, calendarId: cal.calendarId, as: cal.as });
}

export async function removeBookingEvent(b: { calendarId: string; eventId: string | null; googleUserId: string | null }) {
  if (b.eventId && b.calendarId !== "crm") await deleteEvent(b.calendarId, b.eventId, b.googleUserId);
}

/** Block time (owner mode). Returns how to undo it. */
export async function blockTime(r: R, cal: BookingCalendar, o: { start: Date; end: Date; title: string; description: string }): Promise<{ eventId?: string; calendarId?: string; as?: string | null; blockId?: string }> {
  if (cal.mode === "crm") {
    const b = await db.calendarBlock.create({ data: { receptionistId: r.id, start: o.start, end: o.end, title: o.title.slice(0, 120) } });
    return { blockId: b.id };
  }
  const ev = await createEvent({ calendarId: cal.calendarId, start: o.start, end: o.end, timezone: "UTC", summary: o.title, description: o.description, requestId: `block-${Date.now()}`, as: cal.as });
  return { eventId: ev.id, calendarId: cal.calendarId, as: cal.as ?? null };
}

/**
 * Where a caller's reply goes: the email set on the receptionist, else the client's connected
 * calendar account, else the account's main contact or a portal login. Our own lines and demos use
 * the connected Google account, as before.
 */
export async function replyToAddress(r: Pick<Receptionist, "id" | "accountId" | "emailReplyTo" | "googleUserId" | "bookingAddsToCrm" | "lifecycle">, cal?: BookingCalendar | null): Promise<string | null> {
  if (r.emailReplyTo?.includes("@")) return r.emailReplyTo;
  if (cal?.mode === "client" && cal.email) return cal.email;
  if (r.bookingAddsToCrm || r.lifecycle === "demo") {
    const { connectedEmail } = await import("./google");
    return connectedEmail(r.googleUserId);
  }
  const contact = await db.contact.findFirst({ where: { accountId: r.accountId, email: { not: null } }, orderBy: { isPrimary: "desc" }, select: { email: true } });
  if (contact?.email) return contact.email;
  const user = await db.user.findFirst({ where: { accountId: r.accountId, disabled: false }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return user?.email ?? null;
}
