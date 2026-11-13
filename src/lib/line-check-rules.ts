// The daily line check, pure parts (unit tested): what each finding means.

export type LineFacts = {
  hasAgent: boolean;
  agent: "ok" | "missing" | "unknown"; // does the voice agent still exist at ElevenLabs? (unknown = couldn't ask)
  syncStatus: string;
  paused: boolean; // call protection has paused the line
  number: null | { found: boolean; answersHere: boolean; hasBackup: boolean }; // null = this line has no number of its own to check
};

export type LineFindings = { problems: string[]; warnings: string[] };

/** Problems mean callers are being failed now; warnings are worth a look. */
export function evaluateLine(f: LineFacts): LineFindings {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!f.hasAgent) problems.push("No voice agent is set up: callers can only leave a voicemail");
  else if (f.agent === "missing") problems.push("The voice agent was removed from ElevenLabs: callers can only leave a voicemail");
  else if (f.agent === "unknown") warnings.push("Couldn't confirm the voice agent exists (ElevenLabs didn't answer)");
  if (f.paused) problems.push("Call protection has paused the line: callers get voicemail until it's reset");
  if (f.number) {
    if (!f.number.found) problems.push("The phone number isn't on the Twilio account any more");
    else if (!f.number.answersHere) problems.push("The phone number no longer sends calls to this site");
    else if (!f.number.hasBackup) warnings.push("No backup answering on the number (set automatically)");
  }
  if (f.hasAgent && f.syncStatus !== "SYNCED") warnings.push(`Agent changes aren't synced yet (${f.syncStatus.toLowerCase()}): press Sync on the receptionist`);
  return { problems, warnings };
}

export type LineResult = { id: string; name: string; business: string; problems: string[]; warnings: string[] };
export type LineCheckRun = { at: string; lines: LineResult[]; healed: number };

/** Is the last run recent enough to show as current? */
export function checkFresh(at: string | null | undefined, now = Date.now(), hours = 36): boolean {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) && now - t < hours * 3600_000;
}

/** Runs once a day from the 30-minute sweep. */
export function checkDue(at: string | null | undefined, now = Date.now()): boolean {
  const t = at ? Date.parse(at) : NaN;
  return !Number.isFinite(t) || now - t >= 23 * 3600_000;
}
