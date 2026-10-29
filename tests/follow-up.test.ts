import { describe, expect, it } from "vitest";
import { followUpEnabled, isHandledReply, isOptIn, isOptOut, leadAlertWanted, ownerAlertText, pickChannel } from "@/lib/follow-up-rules";

describe("follow-up rules", () => {
  it("turns on per kind", () => {
    expect(followUpEnabled({ followUpOn: "" }, "call")).toBe(false);
    expect(followUpEnabled({ followUpOn: "bookings" }, "booking")).toBe(true);
    expect(followUpEnabled({ followUpOn: "bookings" }, "call")).toBe(false);
    expect(followUpEnabled({ followUpOn: "both" }, "call")).toBe(true);
  });

  it("uses the caller's choice, falling back to the contact we have", () => {
    expect(pickChannel("caller_choice", "email", "604", "a@b.co")).toBe("email");
    expect(pickChannel("caller_choice", "text", "604", "a@b.co")).toBe("sms");
    expect(pickChannel("caller_choice", "email", "604", null)).toBe("sms");
    expect(pickChannel("caller_choice", null, "604", "a@b.co")).toBe(null);
    expect(pickChannel("caller_choice", "none", "604", "a@b.co")).toBe(null);
  });

  it("uses a fixed channel unless the caller declines", () => {
    expect(pickChannel("sms", null, "604", null)).toBe("sms");
    expect(pickChannel("email", "text", "604", "a@b.co")).toBe("email");
    expect(pickChannel("sms", "none", "604", null)).toBe(null);
  });
});

describe("owner lead alerts", () => {
  it("sends the right calls for each setting", () => {
    expect(leadAlertWanted("messages", "MESSAGE_TAKEN")).toBe(true);
    expect(leadAlertWanted("messages", "BOOKED")).toBe(false);
    expect(leadAlertWanted("leads", "BOOKED")).toBe(true);
    expect(leadAlertWanted("leads", "SPAM")).toBe(false);
    expect(leadAlertWanted("", "MESSAGE_TAKEN")).toBe(false);
  });
  it("writes a short text with the call-back number and reply option", () => {
    const t = ownerAlertText({ businessName: "Shine 99", callerName: "Dana", callerNumber: "+16045550199", outcome: "MESSAGE_TAKEN", summary: "Wants a quote for gutter cleaning.", canReply: true });
    expect(t).toBe("Shine 99: Dana needs a call back.\nWants a quote for gutter cleaning.\nCall back: +16045550199\nReply 1 when handled.");
    expect(ownerAlertText({ businessName: "X", callerName: null, callerNumber: "+16045550199", outcome: "BOOKED", summary: "", canReply: true })).toBe("X: +16045550199 booked an appointment.");
  });
  it("recognises opt-out, opt-in and handled replies", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut(" Unsubscribe ")).toBe(true);
    expect(isOptOut("please stop by tomorrow")).toBe(false);
    expect(isOptIn("start")).toBe(true);
    expect(isHandledReply("1")).toBe(true);
    expect(isHandledReply("1 more thing")).toBe(false);
  });
});
