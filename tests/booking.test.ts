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

describe("booking helpers", () => {
  it("lists pre-booking questions and the meeting choice in the prompt", async () => {
    const { buildReceptionistPrompt } = await import("../src/lib/rag");
    const p = buildReceptionistPrompt({ name: "Mike", businessName: "Dawn Patrol", greeting: "", persona: "", timezone: "America/Vancouver", businessHours: "", escalationRules: "", extraInstructions: "", bookingEnabled: true, bookingMeetingType: "caller_choice", bookingQuestions: "What do customers call about?\n\nHow should missed calls be handled?" });
    expect(p).toContain("  - What do customers call about?\n  - How should missed calls be handled?");
    expect(p).toContain("meeting_type");
  });

  it("formats North American numbers for SMS", async () => {
    const { toE164 } = await import("../src/lib/twilio");
    expect(toE164("604-966-8897")).toBe("+16049668897");
    expect(toE164("1 (778) 650-4870")).toBe("+17786504870");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });
});

describe("holidays", () => {
  it("knows BC statutory holidays and weekend observances", async () => {
    const { bcHolidays } = await import("@/lib/booking");
    const h = Object.fromEntries(bcHolidays(2026).map((x) => [x.name, x.date]));
    expect(h["Family Day"]).toBe("2026-02-16");
    expect(h["Good Friday"]).toBe("2026-04-03");
    expect(h["Victoria Day"]).toBe("2026-05-18");
    expect(h["B.C. Day"]).toBe("2026-08-03");
    expect(h["Thanksgiving"]).toBe("2026-10-12");
    // Boxing Day 2026 is a Saturday -> observed Monday Dec 28
    expect(h["Boxing Day (observed)"]).toBe("2026-12-28");
    // 2027: Christmas Saturday -> Mon 27, Boxing Sunday -> Tue 28
    const h27 = Object.fromEntries(bcHolidays(2027).map((x) => [x.name, x.date]));
    expect(h27["Christmas Day (observed)"]).toBe("2027-12-27");
    expect(h27["Boxing Day (observed)"]).toBe("2027-12-28");
  });

  it("skips closed days when finding slots", async () => {
    const { candidateSlots, closedDates, parseWeeklyHours } = await import("@/lib/booking");
    const rules = { timezone: TZ, hours: parseWeeklyHours("Mon-Fri 09:00-17:00"), slotMinutes: 20, minNoticeHours: 24, daysAhead: 7, bufferMinutes: 0, closedDates: closedDates("CA-BC", "", 2026) };
    // Fri Oct 9 2026, noon local: Mon Oct 12 is Thanksgiving
    const slots = candidateSlots(rules, zonedTime(2026, 10, 9, 12 * 60, TZ));
    const days = new Set(slots.map((s) => s.toISOString().slice(0, 10)));
    expect(days.has("2026-10-12")).toBe(false);
    expect(days.has("2026-10-13")).toBe(true);
  });
});
