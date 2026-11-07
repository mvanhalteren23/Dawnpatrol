// Cold email campaigns and the do-not-email list (pure; unit tested).

export type CampaignStep = { delayDays: number; subject: string; body: string };

export const MAX_STEPS = 5;

/** The starter sequence a new campaign gets (edit it on the campaign page). */
export const DEFAULT_STEPS: CampaignStep[] = [
  {
    delayDays: 0,
    subject: "Missed calls at {{company}}",
    body: `Hi {{first_name}},

{{personal_line}}

When the phone rings and nobody can get to it, most callers don't leave a voicemail. They call the next business on the list.

I build AI receptionists for small businesses: they answer every call, day or night, book appointments and text you the details. Would you like me to set one up trained on {{company}}, so you can call it and hear it for yourself? It's free to try.

{{sender_name}}`,
  },
  {
    delayDays: 3,
    subject: "",
    body: `Hi {{first_name}}, bumping this up in case it got buried. Happy to build the {{company}} demo so you can hear it answer your calls. Want me to go ahead?

{{demo_line}}

{{sender_name}}`,
  },
  {
    delayDays: 5,
    subject: "",
    body: `Last note from me. If missed calls aren't a problem at {{company}}, no worries and I won't follow up again. If they are, reply "yes" and I'll have your receptionist ready to call tomorrow.

{{sender_name}}`,
  },
];

export const MAX_DAILY_PER_INBOX = 50;

/** Words a template can use, written {{like_this}}. */
export const TEMPLATE_TOKENS = ["first_name", "company", "city", "website", "personal_line", "demo_line", "sender_name"] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_TOKENS)[number], string | null | undefined>>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string | null {
  const at = normalizeEmail(email).lastIndexOf("@");
  return at > 0 ? normalizeEmail(email).slice(at + 1) || null : null;
}

/** What to look up on the do-not-email list for an address: the address, and its whole domain. */
export function suppressionKeys(email: string): string[] {
  const e = normalizeEmail(email);
  const d = emailDomain(e);
  return d ? [e, `@${d}`] : [e];
}

/** A manual entry: an address, or a domain ("@shop.com", "shop.com"). Null when it's neither. */
export function suppressionValue(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/^mailto:/, "");
  if (/^[^\s@<>",;]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return v;
  const domain = v.replace(/^@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? `@${domain}` : null;
}

/** Big free mail providers: never suppress a whole domain like gmail.com. */
export function isSharedMailDomain(domain: string): boolean {
  return /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|shaw|telus|rogers|sympatico|bell|videotron|cogeco|gmx|mail|zoho)\.[a-z.]+$/i.test(domain.replace(/^@/, ""));
}

/** The reply's own words: everything above the quoted original. */
export function replyText(text: string): string {
  const cut = text.search(/\n?\s*(On .{0,200}wrote:|-{2,}\s*Original Message|From:\s.+\nSent:|________________)/i);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

/** "Unsubscribe", "remove me", "stop emailing me", a bare STOP… in the reply's own words. */
export function isEmailOptOut(text: string): boolean {
  const own = replyText(text);
  if (/^\s*(stop|unsubscribe|remove|optout|opt out)\s*[.!]?\s*$/i.test(own)) return true;
  return /\b(unsubscribe|remove (me|us|my email|this email|our email)|take (me|us) off|stop (emailing|e-?mailing|sending|contacting)|do not (email|e-?mail|contact)|don'?t (email|e-?mail|contact)|opt(ed)?[- ]?out|no more emails|not interested[^.?!]{0,40}(email|contact))\b/i.test(own);
}

export function isBounce(from: string, subject: string): boolean {
  return /mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(from) || /^(delivery status notification|undeliverable|undelivered mail|mail delivery failed|returned mail|delivery (has )?failed|address not found)/i.test(subject.trim());
}

export function isAutoReply(subject: string, text = ""): boolean {
  return /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|away from (the )?office|on vacation|i('| a)m (currently )?(away|out))/i.test(subject.trim()) || /^\s*(i am|i'm) (currently )?(out of (the )?office|away)/i.test(text);
}

/** Template words that aren't in TEMPLATE_TOKENS (typos would otherwise be sent as-is). */
export function unknownTokens(text: string): string[] {
  const found = Array.from(text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g), (m) => m[1]);
  return Array.from(new Set(found.filter((t) => !(TEMPLATE_TOKENS as readonly string[]).includes(t))));
}

/** Fill {{tokens}}; a line left empty by a blank token (e.g. no personal line) is dropped. */
export function renderTemplate(text: string, vars: TemplateVars): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const hadToken = /\{\{/.test(line);
    const filled = line.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => {
      const v = vars[k as keyof TemplateVars];
      return v == null ? "" : String(v).trim();
    });
    if (hadToken && !filled.trim()) continue;
    out.push(filled.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Validate a campaign's steps. Returns the cleaned steps or a reason. */
export function checkSteps(raw: unknown): { steps: CampaignStep[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "No emails in the sequence" };
  const steps = raw
    .map((s) => ({ delayDays: Math.round(Number((s as CampaignStep)?.delayDays) || 0), subject: String((s as CampaignStep)?.subject ?? "").trim(), body: String((s as CampaignStep)?.body ?? "").trim() }))
    .filter((s) => s.body);
  if (!steps.length) return { error: "Write at least the first email" };
  if (steps.length > MAX_STEPS) return { error: `At most ${MAX_STEPS} emails in a sequence` };
  if (!steps[0].subject) return { error: "The first email needs a subject" };
  for (const [i, s] of steps.entries()) {
    if (i > 0 && (s.delayDays < 1 || s.delayDays > 30)) return { error: `Email ${i + 1}: wait 1 to 30 days after the previous one` };
    const bad = unknownTokens(`${s.subject}\n${s.body}`);
    if (bad.length) return { error: `Email ${i + 1}: unknown {{${bad[0]}}}. Use ${TEMPLATE_TOKENS.map((t) => `{{${t}}}`).join(", ")}` };
    if (/unsubscribe/i.test(s.body)) return { error: `Email ${i + 1}: leave the unsubscribe line out; it's added to every email automatically` };
  }
  steps[0].delayDays = 0;
  return { steps };
}

/** Hour (0-23), weekday (0 = Sunday) and date (YYYY-MM-DD) in a time zone. */
export function localParts(now: Date, timeZone: string): { hour: number; minute: number; weekday: number; date: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { hour: Number(p.hour) % 24, minute: Number(p.minute), weekday, date: `${p.year}-${p.month}-${p.day}` };
}

export function inSendWindow(now: Date, o: { timezone: string; sendStartHour: number; sendEndHour: number; weekdaysOnly: boolean }): boolean {
  const t = localParts(now, o.timezone);
  if (o.weekdaysOnly && (t.weekday === 0 || t.weekday === 6)) return false;
  return t.hour >= o.sendStartHour && t.hour < o.sendEndHour;
}

/**
 * How many to send from one inbox on this run, so the day's allowance is spread across the
 * window (runs are every 30 minutes) instead of going out in one burst.
 */
export function sendsThisRun(o: { remainingToday: number; now: Date; timezone: string; sendEndHour: number }): number {
  if (o.remainingToday <= 0) return 0;
  const t = localParts(o.now, o.timezone);
  const minutesLeft = Math.max(1, (o.sendEndHour - t.hour) * 60 - t.minute);
  const runsLeft = Math.max(1, Math.ceil(minutesLeft / 30));
  return Math.min(o.remainingToday, Math.ceil(o.remainingToday / runsLeft));
}

/** The mailbox with the most room left today (ties: the first listed). */
export function pickSender(room: { sender: string; remaining: number }[]): string | null {
  let best: { sender: string; remaining: number } | null = null;
  for (const r of room) if (r.remaining > 0 && (!best || r.remaining > best.remaining)) best = r;
  return best?.sender ?? null;
}

/** When the next email in the sequence is due, or null when the sequence is finished. */
export function nextSendAt(steps: CampaignStep[], sentSoFar: number, sentAt: Date): Date | null {
  const next = steps[sentSoFar];
  return next ? new Date(sentAt.getTime() + next.delayDays * 86_400_000) : null;
}

/** The identification and unsubscribe lines every campaign email ends with (CASL). */
export function emailFooter(o: { legalName: string; address: string; unsubscribeUrl: string }): string {
  return `--\n${o.legalName} · ${o.address}\nNot interested? Unsubscribe here and you won't hear from us again: ${o.unsubscribeUrl}`;
}

/** Follow-ups reply in the same thread. */
export function followUpSubject(firstSubject: string): string {
  return /^re:/i.test(firstSubject.trim()) ? firstSubject.trim() : `Re: ${firstSubject.trim()}`;
}

/** A personal line from the AI is only used if it's one plain sentence with no links. */
export function cleanPersonalLine(line: string | null | undefined): string | null {
  const l = (line ?? "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (!l || l.length > 220 || /https?:|www\.|@|\{\{|<|>/i.test(l)) return null;
  return l;
}

/** Fill-in for the first email's greeting when there's no first name. */
export function greetingName(firstName: string | null | undefined): string {
  const n = (firstName ?? "").trim();
  return n && /^[\p{L}' -]{1,30}$/u.test(n) ? n.charAt(0).toUpperCase() + n.slice(1) : "there";
}
