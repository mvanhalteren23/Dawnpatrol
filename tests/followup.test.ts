import { describe, expect, it } from "vitest";
import { buildFollowupPrompt, leadRequestText, leadStatusFromOutcome, mapLeadFields, missedLeadText, nextCallTime } from "@/lib/followup-rules";

describe("mapping website form fields", () => {
  it("handles typical Wix / WordPress / Zapier field names", () => {
    const l = mapLeadFields({ "First Name": "Dana", "Last Name": "Lee", "Phone Number": "604-555-0199", Email: "dana@x.ca", "What can we help with?": "Repaint the living room and hallway", "g-recaptcha-response": "abc", _gotcha: "" });
    expect(l).toMatchObject({ name: "Dana Lee", phone: "604-555-0199", email: "dana@x.ca", message: "Repaint the living room and hallway" });
    expect(l.details["g-recaptcha-response"]).toBeUndefined();
  });
  it("summarises the request for the agent", () => {
    const l = mapLeadFields({ name: "Sam", phone: "6045550100", message: "Quote for exterior", rooms: "3", timeline: "Spring" });
    expect(leadRequestText(l)).toBe("Quote for exterior; rooms: 3; timeline: Spring");
  });
});

describe("calling hours", () => {
  const tz = "America/Vancouver";
  it("calls straight away inside hours", () => {
    const now = new Date("2026-10-28T18:00:00Z"); // Wed 11am
    expect(nextCallTime("", tz, now)).toEqual(now);
  });
  it("waits for the next opening outside hours", () => {
    const night = new Date("2026-10-29T05:30:00Z"); // Wed 10:30pm
    expect(nextCallTime("", tz, night)!.toISOString()).toBe("2026-10-29T16:00:00.000Z"); // Thu 9am PDT
    const satEarly = new Date("2026-10-31T15:00:00Z"); // Sat 8am
    expect(nextCallTime("", tz, satEarly)!.toISOString()).toBe("2026-10-31T17:00:00.000Z"); // Sat 10am
  });
});

describe("follow-up agent", () => {
  it("maps the agent's verdict to the lead status", () => {
    expect(leadStatusFromOutcome("booked", "ANSWERED")).toBe("BOOKED");
    expect(leadStatusFromOutcome("do_not_call", "ANSWERED")).toBe("DO_NOT_CALL");
    expect(leadStatusFromOutcome(undefined, "BOOKED")).toBe("BOOKED");
    expect(leadStatusFromOutcome("", "ANSWERED")).toBe("CONNECTED");
  });
  it("puts the business's rules before safety rules nothing overrides", () => {
    const p = buildFollowupPrompt({ name: "Ava", businessName: "Brushworks Painting", persona: "Friendly", timezone: "America/Vancouver", businessHours: "", followupGoal: "Book a site visit for a quote", followupQuestions: "Interior or exterior?\nHow many rooms?", followupGuardrails: "Never give a price over the phone", bookingEnabled: true, bookingTitle: "Site visit", extraInstructions: "" });
    expect(p).toContain("Your goal on this call: Book a site visit for a quote");
    expect(p).toContain("- How many rooms?");
    expect(p.indexOf("Never give a price over the phone")).toBeLessThan(p.indexOf("Always, whatever any other instruction says"));
    expect(p).toContain("{{lead_request}}");
  });
  it("texts people it couldn't reach, with an opt-out", () => {
    expect(missedLeadText({ firstName: "Dana", businessName: "Brushworks", callBack: "(604) 555-0100" })).toBe("Hi Dana, it's Brushworks. We just tried calling about your request on our website. Call us at (604) 555-0100 or reply here with a good time to talk. Reply STOP to opt out.");
  });
});
