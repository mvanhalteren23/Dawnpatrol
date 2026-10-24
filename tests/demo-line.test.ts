import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanDigits, gatherExtension, nextFreeExtension, samePhone, twilioSignature, validateTwilioSignature } from "@/lib/twilio";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

const receptionists: Record<string, { id: string; name: string; elevenLabsAgentId: string | null; account: { id: string; contacts: { id: string; phone: string | null }[] } }> = {
  "101": { id: "r1", name: "Ava", elevenLabsAgentId: "agent_101", account: { id: "acct1", contacts: [{ id: "c1", phone: "(720) 555-0123" }] } },
  "102": { id: "r2", name: "Max", elevenLabsAgentId: null, account: { id: "acct2", contacts: [] } },
};
const recordActivity = vi.fn(async () => ({}));
const registerTwilioCall = vi.fn(async () => "<Response><Connect/></Response>");

vi.mock("@/lib/db", () => ({
  db: { receptionist: { findUnique: async ({ where }: { where: { demoExtension?: string; id?: string } }) => (where.demoExtension ? receptionists[where.demoExtension] ?? null : null) } },
}));
vi.mock("@/lib/demo-line", () => ({ demoLineConfig: async () => ({ number: "+17786504870", greeting: "Welcome to the demo line.", fallbackReceptionistId: null }) }));
vi.mock("@/lib/elevenlabs", () => ({ registerTwilioCall }));
vi.mock("@/lib/outreach", () => ({ recordActivity }));

const APP = "https://app.dawnpatrol-tech.com";
process.env.APP_URL = APP;
process.env.TWILIO_AUTH_TOKEN = "tw-token";

async function call(query: string, params: Record<string, string>, sign = true) {
  const { POST } = await import("@/app/api/voice/demo/route");
  const url = `${APP}/api/voice/demo${query}`;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (sign) headers["x-twilio-signature"] = twilioSignature("tw-token", url, params);
  // Simulate the platform's internal URL differing from the public one.
  const res = await POST(new Request(`http://internal:3000/api/voice/demo${query}`, { method: "POST", headers, body: new URLSearchParams(params).toString() }));
  return { status: res.status, body: await res.text() };
}

const base = { CallSid: "CA1", From: "+17205550123", To: "+17786504870" };

describe("twilio helpers", () => {
  it("signs and validates requests", () => {
    const p = { b: "2", a: "1" };
    const sig = twilioSignature("t", "https://x.test/hook?q=1", p);
    expect(validateTwilioSignature("t", "https://x.test/hook?q=1", p, sig)).toBe(true);
    expect(validateTwilioSignature("t", "https://x.test/hook?q=2", p, sig)).toBe(false);
    expect(validateTwilioSignature("t", "https://x.test/hook?q=1", { ...p, a: "9" }, sig)).toBe(false);
    expect(validateTwilioSignature("t", "https://x.test/hook?q=1", p, null)).toBe(false);
  });
  it("assigns the lowest free extension", () => {
    expect(nextFreeExtension(["101", "102", null, "104"])).toBe("103");
    expect(nextFreeExtension([])).toBe("101");
  });
  it("cleans digits and compares phones", () => {
    expect(cleanDigits("10 1#")).toBe("101");
    expect(samePhone("+1 (720) 555-0123", "7205550123")).toBe(true);
    expect(samePhone("123", "123")).toBe(false);
  });
  it("escapes text inside TwiML", () => {
    expect(gatherExtension("Tom & Jerry's <demo>", "https://a/b?x=1&y=2", "https://a/b")).toContain("Tom &amp; Jerry&apos;s &lt;demo&gt;");
  });
});

describe("demo line webhook", () => {
  beforeEach(() => {
    recordActivity.mockClear();
    registerTwilioCall.mockClear();
  });

  it("rejects unsigned requests", async () => {
    expect((await call("", base, false)).status).toBe(403);
  });

  it("greets and gathers an extension on the first hit", async () => {
    const r = await call("", base);
    expect(r.status).toBe(200);
    expect(r.body).toContain("<Gather");
    expect(r.body).toContain("Welcome to the demo line.");
    expect(r.body).toContain(`${APP}/api/voice/demo?step=ext&amp;attempt=1`);
  });

  it("connects a known extension to its ElevenLabs agent and logs the call", async () => {
    const r = await call("?step=ext&attempt=1", { ...base, Digits: "101" });
    expect(r.body).toBe("<Response><Connect/></Response>");
    expect(registerTwilioCall).toHaveBeenCalledWith("agent_101", "+17205550123", "+17786504870");
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acct1", contactId: "c1", type: "CALL", direction: "INBOUND", externalId: "twilio:CA1" }));
  });

  it("re-prompts for unknown or unsynced extensions, then hangs up", async () => {
    const unknown = await call("?step=ext&attempt=1", { ...base, Digits: "999" });
    expect(unknown.body).toContain("isn&apos;t set up");
    expect(unknown.body).toContain("attempt=2");
    const unsynced = await call("?step=ext&attempt=2", { ...base, Digits: "102" });
    expect(unsynced.body).toContain("isn&apos;t ready yet");
    const last = await call("?step=ext&attempt=3", { ...base, Digits: "" });
    expect(last.body).toContain("<Hangup/>");
    expect(registerTwilioCall).not.toHaveBeenCalled();
  });
});

describe("business line TwiML", () => {
  it("rings the cell with screening, then falls through", async () => {
    const { ringFirst, screenPrompt, forwardSms } = await import("@/lib/twilio");
    const x = ringFirst({ cell: "+16045550000", seconds: 20, callerId: "+16045551111", screenUrl: "https://a.test/s?r=1&x=2", action: "https://a.test/after?r=1" });
    expect(x).toContain('<Dial timeout="20" callerId="+16045551111" action="https://a.test/after?r=1"');
    expect(x).toContain('<Number url="https://a.test/s?r=1&amp;x=2" method="POST">+16045550000</Number>');
    expect(screenPrompt("Acme", "https://a.test/ok")).toContain('numDigits="1"');
    expect(forwardSms("+1604", "+1778", "Hi <there>")).toContain("Text from +1778: Hi &lt;there&gt;");
  });
});
