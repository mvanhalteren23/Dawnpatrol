// Google Meet → CRM (pure; unit tested): which calendar events were Meet calls, who was on them,
// and the transcript as speaker-labelled text.

export const MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
/** How far back ended meetings are looked for, and how long to wait for Meet to finish a transcript. */
export const MEET_LOOKBACK_HOURS = 72;
export const TRANSCRIPT_WAIT_HOURS = 24;
/** The transcript kept on the account (the full Google Doc stays in Drive). */
export const TRANSCRIPT_MAX_CHARS = 40_000;

export type CalendarEvent = {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  conferenceData?: { conferenceId?: string; conferenceSolution?: { key?: { type?: string } } };
  hangoutLink?: string;
};

/** The Meet code of a calendar event ("abc-defg-hij"), or null if it isn't a Google Meet call. */
export function meetCode(e: CalendarEvent): string | null {
  const type = e.conferenceData?.conferenceSolution?.key?.type;
  const id = e.conferenceData?.conferenceId ?? (e.hangoutLink ? e.hangoutLink.split("/").pop() : undefined);
  if (!id || (type && type !== "hangoutsMeet")) return null;
  return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(id) ? id : null;
}

/** A Meet call that has ended (with a few minutes' grace), wasn't cancelled, and is recent enough. */
export function endedMeeting(e: CalendarEvent, now: Date, graceMinutes = 10): boolean {
  if (e.status === "cancelled" || !meetCode(e)) return false;
  const end = Date.parse(e.end?.dateTime ?? "");
  if (!Number.isFinite(end)) return false;
  return end <= now.getTime() - graceMinutes * 60_000 && end >= now.getTime() - MEET_LOOKBACK_HOURS * 3600_000;
}

/** The other people invited (not us, not meeting rooms). */
export function guestEmails(e: CalendarEvent): string[] {
  return [...new Set((e.attendees ?? []).filter((a) => !a.self && !a.resource && a.email).map((a) => a.email!.toLowerCase()))];
}

export type TranscriptEntry = { participant?: string; text?: string; startTime?: string };
export type Participant = { name?: string; signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } };

/** "Dave Smith: ..." lines, consecutive lines from the same person joined, capped at TRANSCRIPT_MAX_CHARS. */
export function transcriptText(entries: TranscriptEntry[], participants: Participant[]): string {
  const names = new Map(participants.map((p) => [p.name ?? "", p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? "Participant"]));
  const lines: string[] = [];
  let last = "";
  for (const e of entries) {
    const text = (e.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const who = names.get(e.participant ?? "") ?? "Participant";
    if (who === last && lines.length) lines[lines.length - 1] += ` ${text}`;
    else lines.push(`${who}: ${text}`);
    last = who;
  }
  const all = lines.join("\n");
  return all.length > TRANSCRIPT_MAX_CHARS ? `${all.slice(0, TRANSCRIPT_MAX_CHARS)}\n… (transcript continues in Google Drive)` : all;
}

/** The activity text for a meeting on the account. */
export function meetingBody(o: { summary?: string | null; nextSteps?: string[]; attendees: string[]; minutes: number | null; recordingUrl?: string | null; transcriptUrl?: string | null; transcript?: string | null; note?: string | null }): string {
  return [
    o.summary ? o.summary.trim() : null,
    o.nextSteps?.length ? `Next steps:\n${o.nextSteps.map((s) => `- ${s}`).join("\n")}` : null,
    `Attendees: ${o.attendees.join(", ") || "—"}${o.minutes ? ` · ${o.minutes} min` : ""}`,
    o.recordingUrl ? `Recording: ${o.recordingUrl}` : null,
    o.transcriptUrl ? `Transcript (Google Docs): ${o.transcriptUrl}` : null,
    o.note ?? null,
    o.transcript ? `\nTranscript:\n${o.transcript}` : null,
  ].filter(Boolean).join("\n");
}
