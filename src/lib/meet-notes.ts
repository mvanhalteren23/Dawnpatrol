import "server-only";
import { db } from "./db";
import { connectedEmail, googleFetch, type GoogleAs } from "./google";
import { getSetting, setSetting } from "./settings";
import { buildMatchIndex, matchAddresses } from "./outreach-rules";
import { addDays } from "./utils";
import {
  endedMeeting, guestEmails, MEET_LOOKBACK_HOURS, MEET_SCOPE, meetCode, meetingBody, transcriptText, TRANSCRIPT_WAIT_HOURS,
  type CalendarEvent, type Participant, type TranscriptEntry,
} from "./meet-rules";

// Google Meet meetings → the account they were with: once a meeting on a connected calendar has
// ended, the CRM matches its guests to an account (contact email, then company domain), fetches the
// Meet transcript (Workspace plans with recording/transcripts), summarises it with next steps, and
// records it on the account with links to the recording and transcript. Read-only: nothing in
// Calendar, Meet or Drive is changed. Needs the "meetings.space.readonly" Google permission.

const MEET = "https://meet.googleapis.com/v2";
const CAL = "https://www.googleapis.com/calendar/v3";

type ConferenceRecord = { name: string; startTime?: string; endTime?: string };
type Transcript = { name: string; state?: string; docsDestination?: { document?: string; exportUri?: string } };
type Recording = { name: string; state?: string; driveDestination?: { file?: string; exportUri?: string } };

export type MeetSyncResult = { meetings: number; recorded: number; needsPermission: string[]; errors: string[] };

/** Connections that can read Meet data (the scope was granted when Google was connected). */
async function meetMailboxes(): Promise<{ as: GoogleAs; email: string; userId: string | null; hasScope: boolean }[]> {
  const out: { as: GoogleAs; email: string; userId: string | null; hasScope: boolean }[] = [];
  const company = (await connectedEmail().catch(() => null))?.toLowerCase();
  if (company) {
    const scopes = (await getSetting("google.scopes")) ?? "";
    const owner = await db.user.findFirst({ where: { email: { equals: company, mode: "insensitive" }, role: { in: ["ADMIN", "REP"] } }, select: { id: true } });
    out.push({ as: null, email: company, userId: owner?.id ?? null, hasScope: scopes.includes(MEET_SCOPE) });
  }
  for (const g of await db.googleAccount.findMany({ where: { user: { disabled: false } }, select: { userId: true, email: true, scopes: true } })) {
    if (g.email.toLowerCase() !== company) out.push({ as: g.userId, email: g.email.toLowerCase(), userId: g.userId, hasScope: g.scopes.includes(MEET_SCOPE) });
  }
  return out;
}

async function pages<T>(url: string, key: string, as: GoogleAs, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let token = "";
  do {
    const sep = url.includes("?") ? "&" : "?";
    const page = await googleFetch<Record<string, unknown>>(`${url}${sep}pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, {}, as);
    out.push(...((page[key] as T[] | undefined) ?? []));
    token = (page.nextPageToken as string | undefined) ?? "";
  } while (token && out.length < max);
  return out;
}

/** Look for ended Meet meetings on every connected calendar and record new ones on their accounts. */
export async function syncMeetTranscripts(now = new Date()): Promise<MeetSyncResult> {
  const result: MeetSyncResult = { meetings: 0, recorded: 0, needsPermission: [], errors: [] };
  const boxes = await meetMailboxes();
  const [contacts, accounts] = await Promise.all([
    db.contact.findMany({ where: { email: { not: null } }, select: { id: true, accountId: true, email: true } }),
    db.account.findMany({ where: { domain: { not: null } }, select: { id: true, domain: true } }),
  ]);
  const index = buildMatchIndex(contacts, accounts);
  const seen = new Set<string>(); // the same meeting on two team calendars is recorded once

  for (const box of boxes) {
    if (!box.hasScope) {
      result.needsPermission.push(box.email);
      continue;
    }
    try {
      const timeMin = new Date(now.getTime() - MEET_LOOKBACK_HOURS * 3600_000).toISOString();
      const events = await pages<CalendarEvent>(`${CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(now.toISOString())}`, "items", box.as, 500);
      for (const e of events) {
        if (!endedMeeting(e, now)) continue;
        const code = meetCode(e)!;
        const guests = guestEmails(e).filter((g) => g !== box.email);
        const match = matchAddresses(guests, index);
        if (!match) continue; // not with anyone in the CRM
        result.meetings++;
        try {
          if (await recordMeeting({ e, code, guests, match, box, now, seen })) result.recorded++;
        } catch (err) {
          result.errors.push(`${e.summary ?? code}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (/insufficient|scope|403/i.test(msg)) result.needsPermission.push(box.email);
      else result.errors.push(`${box.email}: ${msg}`);
    }
  }
  await setSetting("meet.lastSync", JSON.stringify({ at: now.toISOString(), ...result })).catch(() => undefined);
  return result;
}

async function recordMeeting(o: {
  e: CalendarEvent; code: string; guests: string[]; match: { accountId: string; contactId: string | null };
  box: { as: GoogleAs; email: string; userId: string | null }; now: Date; seen: Set<string>;
}): Promise<boolean> {
  const { e, code, box } = o;
  const start = Date.parse(e.start?.dateTime ?? "");
  // The conference(s) held in this meeting space around the event's time.
  const records = (await pages<ConferenceRecord>(`${MEET}/conferenceRecords?filter=${encodeURIComponent(`space.meeting_code = "${code}"`)}`, "conferenceRecords", box.as, 50))
    .filter((r) => !Number.isFinite(start) || Math.abs(Date.parse(r.startTime ?? "") - start) < 6 * 3600_000);
  let recorded = false;
  for (const rec of records) {
    const externalId = `meet:${rec.name}`;
    if (o.seen.has(externalId) || (await db.activity.findUnique({ where: { externalId }, select: { id: true } }))) {
      o.seen.add(externalId);
      continue;
    }
    if (!rec.endTime) continue; // still going
    const endedAt = Date.parse(rec.endTime);
    const [transcripts, recordings, participants] = await Promise.all([
      pages<Transcript>(`${MEET}/${rec.name}/transcripts`, "transcripts", box.as, 20).catch(() => []),
      pages<Recording>(`${MEET}/${rec.name}/recordings`, "recordings", box.as, 20).catch(() => []),
      pages<Participant>(`${MEET}/${rec.name}/participants`, "participants", box.as, 200).catch(() => []),
    ]);
    const pending = transcripts.some((t) => t.state === "STARTED" || t.state === "ENDED") || recordings.some((r) => r.state === "STARTED" || r.state === "ENDED");
    const waited = o.now.getTime() - endedAt > TRANSCRIPT_WAIT_HOURS * 3600_000;
    if (pending && !waited) continue; // Meet is still writing the transcript: try again later

    let transcript = "";
    for (const t of transcripts) {
      const entries = await pages<TranscriptEntry>(`${MEET}/${t.name}/entries`, "transcriptEntries", box.as, 3000).catch(() => []);
      transcript += (transcript ? "\n" : "") + transcriptText(entries, participants);
    }
    // No transcript yet and the meeting only just ended: give Meet a little time before logging without one.
    if (!transcript && !transcripts.length && o.now.getTime() - endedAt < 30 * 60_000) continue;

    let notes: { summary: string; nextSteps: string[] } | null = null;
    if (transcript) {
      const { summarizeMeeting } = await import("./ai");
      notes = await summarizeMeeting(transcript, `Meeting: "${e.summary ?? "Meeting"}". Guests: ${o.guests.join(", ")}.`).catch((err) => {
        console.warn("meeting summary failed", err);
        return null;
      });
    }
    const minutes = rec.startTime && rec.endTime ? Math.max(1, Math.round((Date.parse(rec.endTime) - Date.parse(rec.startTime)) / 60_000)) : null;
    const attendees = participants.map((p) => p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName).filter((x): x is string => Boolean(x));
    const { recordActivity } = await import("./outreach");
    const created = await recordActivity({
      accountId: o.match.accountId,
      contactId: o.match.contactId,
      type: "MEETING",
      direction: "OUTBOUND",
      subject: `${transcript ? "Meeting notes" : "Meeting held"}: ${e.summary ?? "Google Meet"}`,
      body: meetingBody({
        summary: notes?.summary,
        nextSteps: notes?.nextSteps,
        attendees: attendees.length ? attendees : o.guests,
        minutes,
        recordingUrl: recordings.find((r) => r.driveDestination?.exportUri)?.driveDestination?.exportUri ?? null,
        transcriptUrl: transcripts.find((t) => t.docsDestination?.exportUri)?.docsDestination?.exportUri ?? null,
        transcript: transcript || null,
        note: transcript ? null : "No transcript: turn on transcripts in Meet (Google Workspace Business Standard or higher) to get notes here automatically.",
      }),
      source: "meet",
      externalId,
      occurredAt: rec.startTime ? new Date(rec.startTime) : new Date(start || o.now.getTime()),
      createdById: box.userId,
    });
    o.seen.add(externalId);
    if (!created) continue;
    recorded = true;
    // The top next step becomes a task for tomorrow.
    const first = notes?.nextSteps[0];
    if (first) {
      await recordActivity({ accountId: o.match.accountId, contactId: o.match.contactId, type: "TASK", subject: `After the meeting: ${first}`.slice(0, 200), dueAt: addDays(o.now, 1), source: "meet", createdById: box.userId }).catch((e2) => console.warn("meeting task", e2));
    }
  }
  return recorded;
}

/** While the CRM is in use: at most every 10 minutes (with the Gmail sync). */
export async function syncMeetThrottled(): Promise<void> {
  const last = Date.parse((await getSetting("meet.lastLiveSyncAt").catch(() => null)) ?? "") || 0;
  if (Date.now() - last < 10 * 60_000) return;
  await setSetting("meet.lastLiveSyncAt", new Date().toISOString());
  await syncMeetTranscripts().catch((e) => console.warn("Meet sync", (e as Error).message));
}
