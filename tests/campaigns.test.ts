import { describe, expect, it, beforeAll } from "vitest";
import {
  checkSteps,
  cleanPersonalLine,
  DEFAULT_STEPS,
  emailFooter,
  followUpSubject,
  greetingName,
  inSendWindow,
  isAutoReply,
  isBounce,
  isEmailOptOut,
  isSharedMailDomain,
  nextSendAt,
  pickSender,
  renderTemplate,
  replyText,
  sendsThisRun,
  suppressionKeys,
  suppressionValue,
  unknownTokens,
} from "@/lib/campaign-rules";
import { maskEmail, oneClickUrl, readUnsubscribeToken, unsubscribeToken, unsubscribeUrl } from "@/lib/unsubscribe-token";

beforeAll(() => {
  process.env.AUTH_SECRET ||= "test-secret-for-unsubscribe-links";
});

describe("do-not-email list", () => {
  it("checks the address and its whole domain", () => {
    expect(suppressionKeys(" Owner@Shop.com ")).toEqual(["owner@shop.com", "@shop.com"]);
  });

  it("accepts addresses and domains typed by hand", () => {
    expect(suppressionValue("Owner@Shop.com")).toBe("owner@shop.com");
    expect(suppressionValue("@shop.com")).toBe("@shop.com");
    expect(suppressionValue("https://www.shop.com/contact")).toBe("@shop.com");
    expect(suppressionValue("mailto:a@b.ca")).toBe("a@b.ca");
    expect(suppressionValue("not an address")).toBeNull();
  });

  it("never blocks a whole free-mail provider", () => {
    expect(isSharedMailDomain("@gmail.com")).toBe(true);
    expect(isSharedMailDomain("shaw.ca")).toBe(true);
    expect(isSharedMailDomain("@seatoskyauto.com")).toBe(false);
  });
});

describe("reading replies", () => {
  it("spots unsubscribe requests in the reply, not in our quoted email", () => {
    expect(isEmailOptOut("Please remove me from your list")).toBe(true);
    expect(isEmailOptOut("STOP")).toBe(true);
    expect(isEmailOptOut("unsubscribe")).toBe(true);
    expect(isEmailOptOut("Don't email me again")).toBe(true);
    expect(isEmailOptOut("Not interested, please stop emailing")).toBe(true);
    expect(isEmailOptOut("Sure, set it up! What do you need from me?")).toBe(false);
    // Our own footer quoted below a positive reply isn't an opt-out.
    expect(isEmailOptOut("Yes please\n\nOn Mon, Nov 10, 2026 at 9:02 AM Matt <matt@x.com> wrote:\n> Not interested? Unsubscribe here")).toBe(false);
    expect(replyText("Sounds good\n-----Original Message-----\nunsubscribe")).toBe("Sounds good");
  });

  it("tells bounces and out-of-office replies apart from real replies", () => {
    expect(isBounce("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Delivery Status Notification (Failure)")).toBe(true);
    expect(isBounce("postmaster@shop.com", "Undeliverable: Missed calls")).toBe(true);
    expect(isBounce("Dave <dave@shop.com>", "Re: Missed calls at Dave's")).toBe(false);
    expect(isAutoReply("Automatic reply: Missed calls")).toBe(true);
    expect(isAutoReply("Out of Office: back Monday")).toBe(true);
    expect(isAutoReply("Re: Missed calls", "I'm out of the office until Monday")).toBe(true);
    expect(isAutoReply("Re: Missed calls", "Yes, interested")).toBe(false);
  });
});

describe("templates", () => {
  const vars = { first_name: "Dave", company: "Sea to Sky Auto", personal_line: "", demo_line: null, sender_name: "Matt" };

  it("fills in words and drops lines left empty", () => {
    const out = renderTemplate("Hi {{first_name}},\n\n{{personal_line}}\n\nWe help {{company}}.\n\n{{demo_line}}\n\n{{sender_name}}", vars);
    expect(out).toBe("Hi Dave,\n\nWe help Sea to Sky Auto.\n\nMatt");
  });

  it("catches typos in fill-ins", () => {
    expect(unknownTokens("Hi {{firstname}} at {{company}}")).toEqual(["firstname"]);
    expect(unknownTokens("Hi {{ first_name }}")).toEqual([]);
  });

  it("checks the sequence", () => {
    const ok = checkSteps(DEFAULT_STEPS);
    expect("steps" in ok && ok.steps.length).toBe(3);
    expect(checkSteps([{ delayDays: 0, subject: "", body: "Hi" }])).toEqual({ error: "The first email needs a subject" });
    expect(checkSteps([{ delayDays: 0, subject: "Hi", body: "Hi" }, { delayDays: 0, subject: "", body: "Again" }])).toHaveProperty("error");
    expect(checkSteps([{ delayDays: 0, subject: "Hi", body: "Hi {{frist_name}}" }])).toHaveProperty("error");
    expect(checkSteps([{ delayDays: 0, subject: "Hi", body: "Click to unsubscribe" }])).toHaveProperty("error");
    // Blank follow-ups are skipped, not errors.
    const trimmed = checkSteps([{ delayDays: 0, subject: "Hi", body: "One" }, { delayDays: 3, subject: "", body: "" }]);
    expect("steps" in trimmed && trimmed.steps.length).toBe(1);
  });

  it("every default email renders with no leftover fill-ins", () => {
    for (const s of DEFAULT_STEPS) expect(renderTemplate(`${s.subject}\n${s.body}`, vars)).not.toMatch(/\{\{|\}\}/);
  });

  it("follow-ups reply in the thread, greetings fall back politely", () => {
    expect(followUpSubject("Missed calls at Dave's")).toBe("Re: Missed calls at Dave's");
    expect(followUpSubject("Re: Missed calls")).toBe("Re: Missed calls");
    expect(greetingName("dave")).toBe("Dave");
    expect(greetingName("")).toBe("there");
    expect(greetingName("info@shop.com")).toBe("there");
  });

  it("only keeps a safe one-line personal line", () => {
    expect(cleanPersonalLine(' "I saw you take same-day bookings by phone." ')).toBe("I saw you take same-day bookings by phone.");
    expect(cleanPersonalLine("Visit https://evil.example")).toBeNull();
    expect(cleanPersonalLine("x".repeat(300))).toBeNull();
    expect(cleanPersonalLine("")).toBeNull();
  });

  it("ends every email with who it's from and how to opt out", () => {
    const f = emailFooter({ legalName: "Luna VR Inc. (Head Above Digital)", address: "PO Box 1, Squamish, BC", unsubscribeUrl: "https://x.test/unsubscribe/abc" });
    expect(f).toContain("Luna VR Inc.");
    expect(f).toContain("Squamish");
    expect(f).toContain("https://x.test/unsubscribe/abc");
  });
});

describe("sending pace", () => {
  const c = { timezone: "America/Vancouver", sendStartHour: 9, sendEndHour: 16, weekdaysOnly: true };

  it("only sends in business hours on weekdays, in the campaign's time zone", () => {
    expect(inSendWindow(new Date("2026-11-10T18:00:00Z"), c)).toBe(true); // Tue 10am Pacific
    expect(inSendWindow(new Date("2026-11-10T15:00:00Z"), c)).toBe(false); // 7am
    expect(inSendWindow(new Date("2026-11-11T00:30:00Z"), c)).toBe(false); // 4:30pm
    expect(inSendWindow(new Date("2026-11-08T18:00:00Z"), c)).toBe(false); // Sunday
    expect(inSendWindow(new Date("2026-11-08T18:00:00Z"), { ...c, weekdaysOnly: false })).toBe(true);
  });

  it("spreads the day's emails over the remaining runs", () => {
    // 10:00 with 6 hours (12 runs) left and 30 to send: 3 now.
    expect(sendsThisRun({ remainingToday: 30, now: new Date("2026-11-10T18:00:00Z"), timezone: "America/Vancouver", sendEndHour: 16 })).toBe(3);
    // 15:40, one run left: send what's left.
    expect(sendsThisRun({ remainingToday: 4, now: new Date("2026-11-10T23:40:00Z"), timezone: "America/Vancouver", sendEndHour: 16 })).toBe(4);
    expect(sendsThisRun({ remainingToday: 0, now: new Date("2026-11-10T18:00:00Z"), timezone: "America/Vancouver", sendEndHour: 16 })).toBe(0);
  });

  it("uses the inbox with the most room, and schedules follow-ups", () => {
    expect(pickSender([{ sender: "a", remaining: 1 }, { sender: "b", remaining: 3 }])).toBe("b");
    expect(pickSender([{ sender: "a", remaining: 0 }])).toBeNull();
    const at = new Date("2026-11-10T18:00:00Z");
    expect(nextSendAt(DEFAULT_STEPS, 1, at)?.toISOString()).toBe("2026-11-13T18:00:00.000Z");
    expect(nextSendAt(DEFAULT_STEPS, 3, at)).toBeNull();
  });
});

describe("unsubscribe links", () => {
  it("are signed for one address and can't be edited", () => {
    const t = unsubscribeToken("Owner@Shop.com");
    expect(readUnsubscribeToken(t)).toBe("owner@shop.com");
    const other = Buffer.from("someone@else.com").toString("base64url");
    expect(readUnsubscribeToken(`${other}.${t.split(".")[1]}`)).toBeNull();
    expect(readUnsubscribeToken("garbage")).toBeNull();
    expect(unsubscribeUrl("https://x.test/", "a@b.com")).toMatch(/^https:\/\/x\.test\/unsubscribe\//);
    expect(oneClickUrl("https://x.test", "a@b.com")).toMatch(/^https:\/\/x\.test\/api\/unsubscribe\//);
    expect(maskEmail("owner@shop.com")).toBe("ow***@shop.com");
  });
});
