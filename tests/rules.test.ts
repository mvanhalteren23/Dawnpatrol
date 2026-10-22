import { describe, expect, it } from "vitest";
import { buildMatchIndex, matchAddresses, nextFollowUp, nextStageAfterActivity } from "@/lib/outreach-rules";
import { renderPrompt, templateVariables } from "@/lib/prompts";
import { classifyCall } from "@/lib/calls";
import { computeMrr, goalProgress } from "@/lib/metrics";
import { verifyElevenLabsSignature } from "@/lib/webhook-verify";
import { instrumentHtml, verifyLink } from "@/lib/tracking";
import { normalizeDomain } from "@/lib/utils";
import { createHmac } from "node:crypto";

process.env.AUTH_SECRET = "test-secret-1234567890";

describe("outreach rules", () => {
  it("advances stages but never backwards", () => {
    expect(nextStageAfterActivity("PROSPECT", "EMAIL", "OUTBOUND")).toBe("CONTACTED");
    expect(nextStageAfterActivity("CONTACTED", "EMAIL", "INBOUND")).toBe("ENGAGED");
    expect(nextStageAfterActivity("PROPOSAL", "EMAIL", "INBOUND")).toBe("PROPOSAL");
    expect(nextStageAfterActivity("PROSPECT", "NOTE", null)).toBe("PROSPECT");
  });

  it("schedules follow-ups for prospects only", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(nextFollowUp("EMAIL", "OUTBOUND", at, true)?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
    expect(nextFollowUp("EMAIL", "OUTBOUND", at, false)).toBeUndefined();
  });

  it("matches by contact email, then by domain", () => {
    const idx = buildMatchIndex([{ id: "c1", accountId: "a1", email: "Bob@Acme.com" }], [{ id: "a2", domain: "sunrise.co" }]);
    expect(matchAddresses(["bob@acme.com"], idx)).toEqual({ accountId: "a1", contactId: "c1" });
    expect(matchAddresses(["new@sunrise.co"], idx)).toEqual({ accountId: "a2", contactId: null });
    expect(matchAddresses(["x@other.com"], idx)).toBeNull();
  });
});

describe("prompts", () => {
  it("renders variables and blanks unknown ones", () => {
    expect(renderPrompt("Research {{company}} in {{ city }} {{missing}}", { company: "Acme", city: "Boise" })).toBe("Research Acme in Boise ");
    expect(templateVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});

describe("call classification", () => {
  it("detects bookings, messages and missed opportunities", () => {
    expect(classifyCall({ analysis: { transcript_summary: "Caller booked an appointment for Tuesday." } }).outcome).toBe("BOOKED");
    expect(classifyCall({ transcript: [{ role: "agent", message: "I'll take a message and have them call you back" }] })).toEqual({ outcome: "MESSAGE_TAKEN", followUpNeeded: true });
    expect(classifyCall({ metadata: { call_duration_secs: 6 }, transcript: [{ role: "user", message: "hello?" }] }).outcome).toBe("MISSED_OPPORTUNITY");
    expect(classifyCall({ analysis: { data_collection_results: { outcome: { value: "transferred" } } } }).outcome).toBe("TRANSFERRED");
  });
});

describe("metrics", () => {
  it("computes MRR excluding trials and cancelled", () => {
    expect(computeMrr([{ status: "ACTIVE", mrrCents: 50000 }, { status: "PAST_DUE", mrrCents: 30000 }, { status: "TRIALING", mrrCents: 50000 }, { status: "CANCELED", mrrCents: 90000 }])).toBe(80000);
    expect(goalProgress(15)).toMatchObject({ pctOfMin: 50, remainingToMin: 15 });
  });
});

describe("signatures", () => {
  it("verifies ElevenLabs webhook HMAC", () => {
    const body = '{"type":"post_call_transcription"}';
    const t = 1_700_000_000;
    const sig = createHmac("sha256", "whsec").update(`${t}.${body}`).digest("hex");
    expect(verifyElevenLabsSignature(body, `t=${t},v0=${sig}`, "whsec", 1800, t * 1000)).toBe(true);
    expect(verifyElevenLabsSignature(body + " ", `t=${t},v0=${sig}`, "whsec", 1800, t * 1000)).toBe(false);
    expect(verifyElevenLabsSignature(body, `t=${t},v0=${sig}`, "whsec", 1800, (t + 4000) * 1000)).toBe(false);
  });

  it("signs tracked links", () => {
    const html = instrumentHtml('<a href="https://dawnpatrol.co/demo">x</a>', "act1", "https://app.test");
    const m = html.match(/u=([^&]+)&s=([^"]+)/)!;
    expect(verifyLink("act1", decodeURIComponent(m[1]!), m[2]!)).toBe(true);
    expect(verifyLink("act1", "https://evil.test", m[2]!)).toBe(false);
    expect(html).toContain("/api/track/open/act1");
  });
});

describe("utils", () => {
  it("normalises domains", () => {
    expect(normalizeDomain("https://www.Acme.com/contact?x=1")).toBe("acme.com");
    expect(normalizeDomain("bob@acme.co.uk")).toBe("acme.co.uk");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});
