import { describe, expect, it } from "vitest";
import { candidateSlots, formatSlot, freeSlots, parseWeeklyHours, pickSlots, zonedTime } from "@/lib/booking";

const TZ = "America/Vancouver";

describe("parseWeeklyHours", () => {
  it("reads day ranges, lists and split shifts", () => {
    const h = parseWeeklyHours("Mon-Fri 09:00-12:00, 13:00-17:00\nSat 10-14\nTue,Thu 18:00-20:00");
    expect(h[1]).toEqual([[540, 720], [780, 1020]]);
    expect(h[6]).toEqual([[600, 840]]);
    expect(h[2]).toEqual([[1080, 1200]]);
    expect(h[0]).toBeUndefined();
  });
  it("rejects nonsense", () => {
    expect(() => parseWeeklyHours("Funday 9-5")).toThrow();
    expect(() => parseWeeklyHours("Mon 17:00-09:00")).toThrow();
  });
});

describe("timezones", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(zonedTime(2026, 7, 15, 9 * 60, TZ).toISOString()).toBe("2026-07-15T16:00:00.000Z"); // PDT, UTC-7
    expect(zonedTime(2026, 12, 15, 9 * 60, TZ).toISOString()).toBe("2026-12-15T17:00:00.000Z"); // PST, UTC-8
    expect(formatSlot(new Date("2026-07-15T16:00:00Z"), TZ)).toBe("Wednesday, July 15 at 9:00 AM");
  });
});

describe("slots", () => {
  const rules = { timezone: TZ, hours: parseWeeklyHours("Mon-Fri 09:00-11:00"), slotMinutes: 30, minNoticeHours: 2, daysAhead: 7, bufferMinutes: 15 };
  // Monday 2026-10-26 08:00 Vancouver (PDT) = 15:00Z
  const now = new Date("2026-10-26T15:00:00Z");

  it("respects minimum notice and working days", () => {
    const c = candidateSlots(rules, now);
    expect(formatSlot(c[0]!, TZ)).toBe("Monday, October 26 at 10:00 AM"); // 9:00 and 9:30 are inside 2h notice
    expect(c.every((s) => ![0, 6].includes(new Date(s.toLocaleString("en-US", { timeZone: TZ })).getDay()))).toBe(true);
  });

  it("removes slots overlapping busy time plus buffer", () => {
    const busy = [{ start: new Date("2026-10-27T16:30:00Z"), end: new Date("2026-10-27T17:00:00Z") }]; // Tue 9:30-10:00
    const tue = freeSlots(rules, now, busy).filter((s) => formatSlot(s, TZ).startsWith("Tuesday")).map((s) => formatSlot(s, TZ));
    expect(tue).toEqual(["Tuesday, October 27 at 10:30 AM"]); // 9:00 (buffer), 9:30 (busy), 10:00 (buffer) removed
  });

  it("offers a couple per day, or the requested day", () => {
    const free = freeSlots(rules, now, []);
    expect(pickSlots(free, TZ).slots).toHaveLength(6);
    const wed = pickSlots(free, TZ, { date: "2026-10-28" });
    expect(wed.matchedDate).toBe(true);
    expect(wed.slots.every((s) => formatSlot(s, TZ).startsWith("Wednesday"))).toBe(true);
    const sat = pickSlots(free, TZ, { date: "2026-10-31" });
    expect(sat.matchedDate).toBe(false);
    expect(formatSlot(sat.slots[0]!, TZ)).toMatch(/^Monday, November 2/);
  });
});

describe("receptionist prompt booking section", () => {
  it("only mentions the tools when booking is enabled", async () => {
    const { buildReceptionistPrompt } = await import("../src/lib/rag");
    const base = { name: "Ava", businessName: "Dawn Patrol", greeting: "", persona: "Warm", timezone: "America/Vancouver", businessHours: "", escalationRules: "", extraInstructions: "" };
    expect(buildReceptionistPrompt(base)).not.toContain("get_available_times");
    const on = buildReceptionistPrompt({ ...base, bookingEnabled: true, bookingTitle: "Free missed-call audit", bookingSlotMinutes: 20 });
    expect(on).toContain("get_available_times");
    expect(on).toContain("Free missed-call audit, 20 minutes");
  });
});
