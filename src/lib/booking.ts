// Appointment slot finding (pure; unit tested). All "local" values are in the receptionist's
// IANA timezone; instants are UTC Date objects.

export type Interval = { start: Date; end: Date };
export type WeeklyHours = Record<number, [number, number][]>; // weekday (0=Sun) -> [startMin, endMin][]

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayIndex(token: string): number {
  const i = DAYS.indexOf(token.trim().slice(0, 3).toLowerCase());
  if (i < 0) throw new Error(`Unknown day "${token}"`);
  return i;
}

function toMinutes(hhmm: string): number {
  const m = hhmm.trim().match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) throw new Error(`Bad time "${hhmm}"`);
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59) throw new Error(`Bad time "${hhmm}"`);
  return h * 60 + min;
}

/**
 * Parse lines like "Mon-Fri 09:00-12:00, 13:00-17:00" or "Sat 10:00-14:00" or "Tue,Thu 18:00-20:00".
 * Later lines replace earlier ones for the same day.
 */
export function parseWeeklyHours(text: string): WeeklyHours {
  const hours: WeeklyHours = {};
  for (const raw of text.split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z,\-\s]+?)\s+(\d.*)$/);
    if (!m) throw new Error(`Can't read "${line}" — use e.g. "Mon-Fri 09:00-17:00"`);
    const days = new Set<number>();
    for (const part of m[1]!.split(",")) {
      const [a, b] = part.split("-").map((x) => x.trim()).filter(Boolean);
      if (!a) continue;
      if (b) {
        let i = dayIndex(a);
        const end = dayIndex(b);
        days.add(i);
        while (i !== end) {
          i = (i + 1) % 7;
          days.add(i);
        }
      } else days.add(dayIndex(a));
    }
    const ranges = m[2]!.split(",").map((r) => {
      const [s, e] = r.split("-");
      if (!s || !e) throw new Error(`Bad time range "${r.trim()}"`);
      const start = toMinutes(s);
      const end = toMinutes(e);
      if (end <= start) throw new Error(`Range "${r.trim()}" ends before it starts`);
      return [start, end] as [number, number];
    });
    for (const d of days) hours[d] = ranges;
  }
  return hours;
}

// --- Timezone helpers (Intl only, DST-safe) ---------------------------------------

function partsInZone(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}

function offsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local wall-clock time in `tz` -> UTC instant. */
export function zonedTime(y: number, m: number, d: number, minutes: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall - offsetMs(new Date(wall), tz);
  guess = wall - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

export function localDate(date: Date, tz: string): { y: number; m: number; d: number; weekday: number } {
  const p = partsInZone(date, tz);
  return { y: p.y, m: p.m, d: p.d, weekday: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() };
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Wednesday, July 15 at 9:00 AM" — built from parts so it reads the same on every runtime. */
export function formatSlot(date: Date, tz: string): string {
  const p = partsInZone(date, tz);
  const wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${wd}, ${MONTHS[p.m - 1]} ${p.d} at ${h12}:${String(p.min).padStart(2, "0")} ${p.h < 12 ? "AM" : "PM"}`;
}

// --- Slot finding -------------------------------------------------------------------

export type SlotRules = {
  timezone: string;
  hours: WeeklyHours;
  slotMinutes: number;
  minNoticeHours: number;
  daysAhead: number;
  bufferMinutes: number;
};

/** Every bookable slot start in the window, ignoring the calendar. */
export function candidateSlots(rules: SlotRules, now: Date): Date[] {
  const out: Date[] = [];
  const earliest = now.getTime() + rules.minNoticeHours * 3600_000;
  const today = localDate(now, rules.timezone);
  for (let i = 0; i <= rules.daysAhead; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    for (const [startMin, endMin] of rules.hours[day.getUTCDay()] ?? []) {
      for (let t = startMin; t + rules.slotMinutes <= endMin; t += rules.slotMinutes) {
        const start = zonedTime(y, m, d, t, rules.timezone);
        if (start.getTime() >= earliest) out.push(start);
      }
    }
  }
  return out;
}

export function freeSlots(rules: SlotRules, now: Date, busy: Interval[]): Date[] {
  const pad = rules.bufferMinutes * 60_000;
  const len = rules.slotMinutes * 60_000;
  return candidateSlots(rules, now).filter((s) => {
    const a = s.getTime() - pad;
    const b = s.getTime() + len + pad;
    return !busy.some((x) => x.start.getTime() < b && x.end.getTime() > a);
  });
}

/** Pick a short, spoken-friendly list: on a requested day, or a couple per day over the next few days. */
export function pickSlots(slots: Date[], tz: string, opts: { date?: string; timeOfDay?: string; max?: number } = {}): { slots: Date[]; matchedDate: boolean } {
  const max = opts.max ?? 6;
  const tod = (opts.timeOfDay ?? "any").toLowerCase();
  const byTod = slots.filter((s) => {
    if (tod !== "morning" && tod !== "afternoon" && tod !== "evening") return true;
    const h = partsInZone(s, tz).h;
    return tod === "morning" ? h < 12 : tod === "afternoon" ? h >= 12 && h < 17 : h >= 17;
  });
  const pool = byTod.length ? byTod : slots;
  if (opts.date) {
    const onDay = pool.filter((s) => { const l = localDate(s, tz); return isoDate(l.y, l.m, l.d) === opts.date; });
    if (onDay.length) return { slots: spread(onDay, Math.min(max, 4)), matchedDate: true };
    const later = pool.filter((s) => { const l = localDate(s, tz); return isoDate(l.y, l.m, l.d) > opts.date!; });
    return { slots: perDay(later.length ? later : pool, tz, max), matchedDate: false };
  }
  return { slots: perDay(pool, tz, max), matchedDate: true };
}

function spread(list: Date[], n: number): Date[] {
  if (list.length <= n) return list;
  const step = (list.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => list[Math.round(i * step)]!);
}

function perDay(list: Date[], tz: string, max: number): Date[] {
  const groups = new Map<string, Date[]>();
  for (const s of list) {
    const l = localDate(s, tz);
    const k = isoDate(l.y, l.m, l.d);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out: Date[] = [];
  for (const day of groups.values()) {
    out.push(...spread(day, 2));
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
