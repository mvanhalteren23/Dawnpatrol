import "server-only";
import { googleFetch } from "./google";
import type { Interval } from "./booking";

// Google Calendar REST, using the company Google connection (CRM → Settings).

const API = "https://www.googleapis.com/calendar/v3";

export async function busyIntervals(calendarId: string, timeMin: Date, timeMax: Date): Promise<Interval[]> {
  const res = await googleFetch<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> }>(
    `${API}/freeBusy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
    },
  );
  const cal = res.calendars[calendarId] ?? Object.values(res.calendars)[0];
  if (cal?.errors?.length) throw new Error(`Calendar "${calendarId}" can't be read (${cal.errors.map((e) => e.reason).join(", ")}). Share it with the connected Google account.`);
  return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export type NewEvent = {
  calendarId: string;
  start: Date;
  end: Date;
  timezone: string;
  summary: string;
  description: string;
  attendeeEmail?: string | null;
  googleMeet?: boolean;
  requestId: string;
};

export async function createEvent(e: NewEvent): Promise<{ id: string; htmlLink: string; meetLink: string | null }> {
  const body = {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start.toISOString(), timeZone: e.timezone },
    end: { dateTime: e.end.toISOString(), timeZone: e.timezone },
    ...(e.attendeeEmail ? { attendees: [{ email: e.attendeeEmail }] } : {}),
    ...(e.googleMeet ? { conferenceData: { createRequest: { requestId: e.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    reminders: { useDefault: true },
  };
  const created = await googleFetch<{ id: string; htmlLink: string; hangoutLink?: string }>(
    `${API}/calendars/${encodeURIComponent(e.calendarId)}/events?conferenceDataVersion=1&sendUpdates=${e.attendeeEmail ? "all" : "none"}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  return { id: created.id, htmlLink: created.htmlLink, meetLink: created.hangoutLink ?? null };
}
