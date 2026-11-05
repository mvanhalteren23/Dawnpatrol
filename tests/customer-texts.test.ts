import { describe, expect, it } from "vitest";
import {
  bookingLinkUrl, checkinDue, checkinHours, clampThreshold, holidayQuestion, holidaysFor, isConfirm, isReschedule, localHour, noShowText,
  parseUnanswered, questionKey, reminderDue, reminderText, rescueText, rescueWanted, reviewDue, reviewText, saysClosed, textingHours, upcomingHolidays,
} from "@/lib/customer-text-rules";
import { usHolidays } from "@/lib/booking";

const TZ = "America/Los_Angeles";
const H = 3600_000;
// Wednesday 2026-11-04, 10:00 Los Angeles (18:00 UTC).
const now = new Date("2026-11-04T18:00:00Z");

describe("customer texts", () => {
  it("only texts 9am-8pm local time", () => {
    expect(localHour(now, TZ)).toBe(10);
    expect(textingHours(now, TZ)).toBe(true);
    expect(textingHours(new Date("2026-11-05T05:00:00Z"), TZ)).toBe(false); // 9pm
  });

  it("rescues calls that ended without a booking", () => {
    expect(rescueWanted("MISSED_OPPORTUNITY")).toBe(true);
    expect(rescueWanted("MESSAGE_TAKEN")).toBe(true);
    expect(rescueWanted("BOOKED")).toBe(false);
    expect(rescueWanted("SPAM")).toBe(false);
    expect(rescueText({ businessName: "Acme Auto", callerName: "Sam Lee", bookingLink: "https://x.test/book/k" })).toMatch(/^Hi Sam, thanks for calling Acme Auto\..*https:\/\/x\.test\/book\/k/);
    expect(rescueText({ businessName: "Acme Auto", callerName: null, bookingLink: null })).toContain("We've got your message");
  });

  it("sends the reminder 12-36 hours ahead, once", () => {
    const b = { status: "BOOKED", start: new Date(now.getTime() + 24 * H), reminderSentAt: null, timezone: TZ };
    expect(reminderDue(b, now)).toBe(true);
    expect(reminderDue({ ...b, start: new Date(now.getTime() + 6 * H) }, now)).toBe(false);
    expect(reminderDue({ ...b, start: new Date(now.getTime() + 48 * H) }, now)).toBe(false);
    expect(reminderDue({ ...b, reminderSentAt: now }, now)).toBe(false);
    expect(reminderDue({ ...b, status: "CANCELLED" }, now)).toBe(false);
    expect(reminderText({ businessName: "Acme", customerName: "Sam", title: "Oil change", start: new Date("2026-11-05T17:00:00Z"), timezone: TZ })).toBe("Hi Sam, a reminder from Acme: your oil change is Thursday, November 5 at 9:00 AM. Reply C to confirm or R to reschedule.");
  });

  it("reads confirm and reschedule replies", () => {
    for (const y of ["C", "c", "yes", "Confirm", "ok!"]) expect(isConfirm(y)).toBe(true);
    for (const r of ["R", "reschedule", "can't make it"]) expect(isReschedule(r)).toBe(true);
    expect(isConfirm("can you come earlier")).toBe(false);
    expect(isReschedule("really looking forward")).toBe(false);
  });

  it("asks every customer for a review after the delay, within three days", () => {
    const b = { status: "BOOKED", end: new Date(now.getTime() - 4 * H), reviewAskedAt: null, timezone: TZ };
    expect(reviewDue(b, 3, now)).toBe(true);
    expect(reviewDue(b, 6, now)).toBe(false);
    expect(reviewDue({ ...b, end: new Date(now.getTime() - 4 * 24 * H) }, 3, now)).toBe(false);
    expect(reviewDue({ ...b, status: "NO_SHOW" }, 3, now)).toBe(false);
    expect(reviewText({ businessName: "Acme", customerName: "Sam", reviewLink: "https://g.page/r/x" })).toContain("https://g.page/r/x");
    expect(noShowText({ businessName: "Acme", customerName: "Sam", bookingLink: "https://x.test/b" })).toContain("https://x.test/b");
    expect(bookingLinkUrl("https://app.test/", "abc", "b1")).toBe("https://app.test/book/abc?r=b1");
    expect(bookingLinkUrl("https://app.test", null)).toBeNull();
  });
});

describe("owner check-ins", () => {
  it("groups the same question asked different ways", () => {
    expect(questionKey("What are your hours on Sunday?")).toBe(questionKey("what are your Sunday hours"));
    expect(questionKey("Do you fix diesels?")).not.toBe(questionKey("Do you fix boats?"));
    expect(parseUnanswered("Do you fix diesels?\n- Can I pay with crypto?\nnone")).toEqual(["Do you fix diesels?", "Can I pay with crypto?"]);
    expect(parseUnanswered(42)).toEqual([]);
  });

  it("calls at most weekly, once 3-5 questions wait or a holiday is close", () => {
    expect(clampThreshold(1)).toBe(3);
    expect(clampThreshold(9)).toBe(5);
    expect(checkinDue({ lastCheckinAt: null, openCallerQuestions: 3, threshold: 3, holidayDue: false }, now)).toBe(true);
    expect(checkinDue({ lastCheckinAt: null, openCallerQuestions: 3, threshold: 4, holidayDue: false }, now)).toBe(false);
    expect(checkinDue({ lastCheckinAt: null, openCallerQuestions: 0, threshold: 5, holidayDue: true }, now)).toBe(true);
    expect(checkinDue({ lastCheckinAt: new Date(now.getTime() - 3 * 24 * H), openCallerQuestions: 9, threshold: 3, holidayDue: true }, now)).toBe(false);
    expect(checkinHours(now, TZ)).toBe(true); // Wednesday 10am
    expect(checkinHours(new Date("2026-11-07T18:00:00Z"), TZ)).toBe(false); // Saturday
    expect(checkinHours(new Date("2026-11-04T16:00:00Z"), TZ)).toBe(false); // 8am
  });

  it("asks about holidays in the next two weeks", () => {
    const bc = holidaysFor({ bookingHolidays: "CA-BC", timezone: "America/Vancouver", country: null }, 2026);
    expect(upcomingHolidays(bc, "2026-11-04").map((h) => h.name)).toEqual(["Remembrance Day"]);
    expect(holidaysFor({ bookingHolidays: "", timezone: TZ, country: "US" }, 2026)).toEqual(usHolidays(2026));
    expect(usHolidays(2026).find((h) => h.name === "Thanksgiving")?.date).toBe("2026-11-26");
    expect(usHolidays(2026).find((h) => h.name === "Memorial Day")?.date).toBe("2026-05-25");
    expect(holidayQuestion({ date: "2026-11-11", name: "Remembrance Day" })).toBe("Are you open on Remembrance Day, Wednesday, November 11? If so, what hours?");
  });

  it("spots 'closed' answers to holiday questions", () => {
    expect(saysClosed("We're closed that day")).toBe(true);
    expect(saysClosed("No, we're not open")).toBe(true);
    expect(saysClosed("Open 9am to 1pm")).toBe(false);
    expect(saysClosed("closed in the morning, open from 1pm")).toBe(false);
  });
});

describe("matching check-in answers to questions", () => {
  it("finds the question an answer belongs to", async () => {
    const { matchQuestion } = await import("@/lib/customer-text-rules");
    const qs = [{ id: "h", question: "Are you open on Remembrance Day, Wednesday, November 11? If so, what hours?" }, { id: "d", question: "Do you work on diesels?" }];
    expect(matchQuestion("Are you open on Remembrance Day", qs)?.id).toBe("h");
    expect(matchQuestion("work on diesels", qs)?.id).toBe("d");
    expect(matchQuestion("What's the weather like", qs)).toBeNull();
  });
});
