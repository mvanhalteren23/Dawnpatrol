// Phone notification preferences and quiet hours (pure; unit tested).

export const PUSH_CATEGORIES = {
  lines: { label: "Line problems", help: "A client's line failing its daily check, calls going to voicemail, a line paused, voice credits or phone balance running out." },
  leads: { label: "New leads", help: "Website demo requests and demos booked by Grace on our line." },
  replies: { label: "Email replies", help: "Someone replied to a cold email campaign." },
  billing: { label: "Billing", help: "A payment failed, or a client is near or over their minutes." },
} as const;

export type PushCategory = keyof typeof PUSH_CATEGORIES;

export type PushPrefs = {
  off: PushCategory[]; // categories switched off
  quietStart: number | null; // hour 0-23, e.g. 21
  quietEnd: number | null; // hour 0-23, e.g. 7
  urgentInQuiet: boolean; // line outages still come through in quiet hours
  timezone: string;
};

export const DEFAULT_PREFS: PushPrefs = { off: [], quietStart: 21, quietEnd: 7, urgentInQuiet: true, timezone: "America/Vancouver" };

export function isCategory(v: unknown): v is PushCategory {
  return typeof v === "string" && v in PUSH_CATEGORIES;
}

const hour = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);

export function parsePrefs(raw: string | null | undefined): PushPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const j = JSON.parse(raw) as Partial<PushPrefs>;
    return {
      off: Array.isArray(j.off) ? j.off.filter(isCategory) : [],
      quietStart: j.quietStart === null ? null : (hour(j.quietStart) ?? DEFAULT_PREFS.quietStart),
      quietEnd: j.quietEnd === null ? null : (hour(j.quietEnd) ?? DEFAULT_PREFS.quietEnd),
      urgentInQuiet: typeof j.urgentInQuiet === "boolean" ? j.urgentInQuiet : true,
      timezone: typeof j.timezone === "string" && j.timezone ? j.timezone : DEFAULT_PREFS.timezone,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** The local hour in a time zone (falls back to Vancouver for an unknown zone). */
export function localHour(now: Date, timezone: string): number {
  const fmt = (tz: string) => Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  try {
    return fmt(timezone);
  } catch {
    return fmt(DEFAULT_PREFS.timezone);
  }
}

/** Quiet hours can wrap midnight (21 → 7). Equal start and end means no quiet hours. */
export function inQuietHours(h: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export function shouldNotify(prefs: PushPrefs, category: PushCategory, urgent: boolean, now: Date): boolean {
  if (prefs.off.includes(category)) return false;
  if (!inQuietHours(localHour(now, prefs.timezone), prefs.quietStart, prefs.quietEnd)) return true;
  return urgent && prefs.urgentInQuiet;
}

/** Keep notification text short enough for a phone's lock screen. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Only links inside the CRM are opened from a notification. */
export function safeCrmPath(url: string | null | undefined): string {
  if (!url) return "/crm/today";
  try {
    const u = new URL(url, "https://x.invalid");
    const path = `${u.pathname}${u.search}${u.hash}`;
    return path.startsWith("/crm") ? path : "/crm/today";
  } catch {
    return "/crm/today";
  }
}
