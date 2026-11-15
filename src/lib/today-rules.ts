// Today screen helpers (pure; unit tested).

/** Offset (ms) of a time zone from UTC at this moment. */
function zoneOffset(at: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function safeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return "America/Vancouver";
  }
}

/** Local midnight at the end of today (the cut-off for "due today"). */
export function endOfLocalDay(now: Date, timezone: string): Date {
  const tz = safeZone(timezone);
  const local = new Date(now.getTime() + zoneOffset(now, tz));
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return new Date(midnightLocal - zoneOffset(new Date(midnightLocal), tz));
}

/** 9am tomorrow, local time (snoozed follow-ups). */
export function tomorrowMorning(now: Date, timezone: string): Date {
  const tz = safeZone(timezone);
  const local = new Date(now.getTime() + zoneOffset(now, tz));
  const nineLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 9);
  return new Date(nineLocal - zoneOffset(new Date(nineLocal), tz));
}

/** "Overdue 3 days", "Due today", "Due 2:30 pm". */
export function dueLabel(due: Date, now: Date, timezone: string): { text: string; overdue: boolean } {
  const end = endOfLocalDay(now, timezone);
  const startToday = new Date(end.getTime() - 24 * 3600_000);
  if (due < startToday) {
    const days = Math.max(1, Math.ceil((startToday.getTime() - due.getTime()) / (24 * 3600_000)));
    return { text: `Overdue ${days} day${days === 1 ? "" : "s"}`, overdue: true };
  }
  if (due < now) return { text: "Due now", overdue: true };
  const time = new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(timezone), hour: "numeric", minute: "2-digit" }).format(due);
  return { text: `Due ${time}`, overdue: false };
}

/** The best number to call or text for an account: a contact's mobile first, else the main line. */
export function bestNumber(accountPhone: string | null, contacts: { phone: string | null; isPrimary: boolean }[]): string | null {
  const primary = contacts.find((c) => c.isPrimary && c.phone)?.phone;
  return primary ?? contacts.find((c) => c.phone)?.phone ?? accountPhone ?? null;
}
