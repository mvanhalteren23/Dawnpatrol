import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, clip, inQuietHours, localHour, parsePrefs, safeCrmPath, shouldNotify } from "@/lib/push-rules";
import { passkeyName, rpFor } from "@/lib/passkey-rules";
import { landingPath } from "@/lib/login-rules";
import { bestNumber, dueLabel, endOfLocalDay, tomorrowMorning } from "@/lib/today-rules";
import { isMapsUrl, nameFromTitle, parseShare } from "@/lib/share-rules";
import { bridgeIdFromKey, endedReason, isFinalLegStatus, legKey, legPhase, maskPhone, parsePending } from "@/lib/dialer-bridge-rules";

// Fixed-offset zones only (no daylight-saving rules), so results don't depend on the runner's tz data.
const UTC = "UTC";
const PST = "Etc/GMT+8"; // UTC-8 all year

describe("phone notifications", () => {
  it("reads saved preferences and falls back to sensible defaults", () => {
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    const p = parsePrefs(JSON.stringify({ off: ["replies", "bogus"], quietStart: null, quietEnd: null, urgentInQuiet: false, timezone: UTC }));
    expect(p.off).toEqual(["replies"]);
    expect(p.quietStart).toBeNull();
    expect(p.urgentInQuiet).toBe(false);
    expect(parsePrefs(JSON.stringify({ quietStart: 99 })).quietStart).toBe(21);
  });

  it("quiet hours wrap past midnight", () => {
    expect(inQuietHours(22, 21, 7)).toBe(true);
    expect(inQuietHours(3, 21, 7)).toBe(true);
    expect(inQuietHours(7, 21, 7)).toBe(false);
    expect(inQuietHours(12, 21, 7)).toBe(false);
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(13, null, 7)).toBe(false);
    expect(inQuietHours(13, 8, 8)).toBe(false);
  });

  it("uses the user's time zone", () => {
    const at = new Date("2026-11-15T06:30:00Z");
    expect(localHour(at, UTC)).toBe(6);
    expect(localHour(at, PST)).toBe(22);
    expect(localHour(at, "Not/AZone")).toBeGreaterThanOrEqual(0);
  });

  it("holds back all but urgent alerts in quiet hours, and respects switched-off kinds", () => {
    const prefs = { ...DEFAULT_PREFS, timezone: PST };
    const night = new Date("2026-11-15T06:30:00Z"); // 10:30pm
    const day = new Date("2026-11-15T19:00:00Z"); // 11am
    expect(shouldNotify(prefs, "leads", false, day)).toBe(true);
    expect(shouldNotify(prefs, "leads", false, night)).toBe(false);
    expect(shouldNotify(prefs, "lines", true, night)).toBe(true);
    expect(shouldNotify({ ...prefs, urgentInQuiet: false }, "lines", true, night)).toBe(false);
    expect(shouldNotify({ ...prefs, off: ["leads"] }, "leads", false, day)).toBe(false);
  });

  it("keeps text short and only opens CRM pages", () => {
    expect(clip("a  b\n c", 10)).toBe("a b c");
    expect(clip("x".repeat(50), 10)).toHaveLength(10);
    expect(safeCrmPath("/crm/accounts/1")).toBe("/crm/accounts/1");
    expect(safeCrmPath("https://evil.example/crm")).toBe("/crm");
    expect(safeCrmPath("/portal")).toBe("/crm/today");
    expect(safeCrmPath(null)).toBe("/crm/today");
  });
});

describe("passkeys and sign-in", () => {
  it("belongs to the bare domain and accepts www", () => {
    expect(rpFor("https://headabovedigital.com")).toEqual({ rpID: "headabovedigital.com", origins: ["https://headabovedigital.com", "https://www.headabovedigital.com"] });
    expect(rpFor("https://www.headabovedigital.com/").rpID).toBe("headabovedigital.com");
    expect(rpFor("http://localhost:3000")).toEqual({ rpID: "localhost", origins: ["http://localhost:3000"] });
  });

  it("names a passkey after the device", () => {
    expect(passkeyName("Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit")).toBe("Pixel 10 Pro");
    expect(passkeyName("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit")).toBe("Android phone");
    expect(passkeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(passkeyName("")).toBe("Passkey");
  });

  it("lands staff in the CRM and clients in the portal, never off-site", () => {
    expect(landingPath("ADMIN", "/crm/health")).toBe("/crm/health");
    expect(landingPath("REP", "//evil.com")).toBe("/crm");
    expect(landingPath("REP", "/\\evil.com")).toBe("/crm");
    expect(landingPath("CLIENT", "/crm")).toBe("/portal");
    expect(landingPath("CLIENT", "/portal/photos")).toBe("/portal/photos");
  });
});

describe("Today screen", () => {
  const now = new Date("2026-11-15T19:00:00Z"); // 11am at UTC-8

  it("works out today's cut-off and tomorrow morning in the user's zone", () => {
    expect(endOfLocalDay(now, PST).toISOString()).toBe("2026-11-16T08:00:00.000Z");
    expect(endOfLocalDay(now, UTC).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(tomorrowMorning(now, PST).toISOString()).toBe("2026-11-16T17:00:00.000Z");
    expect(endOfLocalDay(now, "Bad/Zone")).toBeInstanceOf(Date);
  });

  it("labels follow-ups", () => {
    expect(dueLabel(new Date("2026-11-13T18:00:00Z"), now, PST)).toEqual({ text: "Overdue 2 days", overdue: true });
    expect(dueLabel(new Date("2026-11-15T17:00:00Z"), now, PST)).toEqual({ text: "Due now", overdue: true });
    const later = dueLabel(new Date("2026-11-15T22:30:00Z"), now, PST);
    expect(later.overdue).toBe(false);
    expect(later.text).toMatch(/^Due 2:30/);
  });

  it("calls the main contact first, then the business line", () => {
    expect(bestNumber("+16045550000", [{ phone: "+17785550001", isPrimary: false }, { phone: "+17785550002", isPrimary: true }])).toBe("+17785550002");
    expect(bestNumber("+16045550000", [{ phone: null, isPrimary: true }])).toBe("+16045550000");
    expect(bestNumber(null, [])).toBeNull();
  });
});

describe("Share to Head Above", () => {
  it("reads a Google Maps share", () => {
    const b = parseShare({ text: "Sea to Sky Auto\n38000 Cleveland Ave, Squamish, BC V8B 0A1\n(604) 555-0199\nhttps://maps.app.goo.gl/AbCd123" });
    expect(b.name).toBe("Sea to Sky Auto");
    expect(b.address).toBe("38000 Cleveland Ave, Squamish, BC V8B 0A1");
    expect(b.city).toBe("Squamish");
    expect(b.state).toBe("BC");
    expect(b.phone).toBe("(604) 555-0199");
    expect(b.mapsUrl).toBe("https://maps.app.goo.gl/AbCd123");
    expect(b.website).toBeNull();
  });

  it("reads a Maps share joined with dots, and one with only a name and link", () => {
    const b = parseShare({ text: "Howe Sound Plumbing · 1200 Main St, Whistler, BC · https://maps.app.goo.gl/x" });
    expect(b.name).toBe("Howe Sound Plumbing");
    expect(b.city).toBe("Whistler");
    const c = parseShare({ title: "Tantalus Roofing", text: "https://maps.app.goo.gl/y" });
    expect(c.name).toBe("Tantalus Roofing");
  });

  it("reads a web page shared from Chrome (link in the text)", () => {
    const b = parseShare({ title: "Brackendale Electric | Licensed Electricians in Squamish", text: "https://www.brackendaleelectric.ca/about" });
    expect(b.name).toBe("Brackendale Electric");
    expect(b.website).toBe("https://www.brackendaleelectric.ca/about");
  });

  it("doesn't treat Facebook or Yelp as the business website", () => {
    const b = parseShare({ title: "Squamish Glass - Home | Facebook", url: "https://www.facebook.com/squamishglass" });
    expect(b.website).toBeNull();
    expect(b.otherUrl).toBe("https://www.facebook.com/squamishglass");
    expect(b.name).toBe("Squamish Glass");
  });

  it("doesn't mistake digits in a business name for its phone number", () => {
    const b = parseShare({ text: "Unit 1234567890 Storage\n1001 Main St, Squamish, BC\nhttps://maps.app.goo.gl/z" });
    expect(b.name).toBe("Unit 1234567890 Storage");
    expect(b.phone).toBeNull();
  });

  it("spots Maps links and cleans titles", () => {
    expect(isMapsUrl("https://maps.app.goo.gl/x")).toBe(true);
    expect(isMapsUrl("https://www.google.com/maps/place/x")).toBe(true);
    expect(isMapsUrl("https://www.google.com/search?q=x")).toBe(false);
    expect(nameFromTitle("Home - Peak Heating")).toBe("Peak Heating");
    expect(nameFromTitle("Welcome to Peak Heating")).toBe("Peak Heating");
  });
});

describe("Call my phone dialer", () => {
  it("gives each prospect call its own key", () => {
    const id = "cmwh5fgsy009k7dbn0gww3uh2";
    expect(legKey(id, 3)).toBe(`br3_${id}`);
    expect(bridgeIdFromKey(legKey(id, 3))).toBe(id);
    expect(bridgeIdFromKey("CA123")).toBeNull();
  });

  it("follows the prospect's leg", () => {
    expect(legPhase("queued")).toBe("connecting");
    expect(legPhase("ringing")).toBe("ringing");
    expect(legPhase("in-progress")).toBe("live");
    expect(legPhase("no-answer")).toBe("ended");
    expect(isFinalLegStatus("completed")).toBe(true);
    expect(isFinalLegStatus("ringing")).toBe(false);
  });

  it("explains why the session ended and masks the number", () => {
    expect(endedReason("no-answer", false)).toMatch(/wasn't answered/);
    expect(endedReason("completed", false)).toMatch(/before you pressed 1/);
    expect(endedReason("completed", true)).toBe("Your phone hung up.");
    expect(maskPhone("+16045550123")).toBe("(604) ···-0123");
  });

  it("reads a queued call safely", () => {
    expect(parsePending("")).toBeNull();
    expect(parsePending("{bad")).toBeNull();
    expect(parsePending(JSON.stringify({ key: "br1_x", accountId: "a", contactId: null, to: "+16045550123", vm: null, vmId: "" }))?.to).toBe("+16045550123");
  });
});

describe("Hear it answer as your business", async () => {
  const { cleanWebsite, demoDelayedText, demoReadyText, demoRequestProblem } = await import("@/lib/demo-request-rules");
  const ok = { name: "Dana Lee", business: "Atwell Peak Contracting", website: "atwellpeak.ca", city: "", phone: "604 555 0199", consent: true };

  it("accepts website addresses as people type them", () => {
    expect(cleanWebsite("atwellpeak.ca")).toBe("https://atwellpeak.ca");
    expect(cleanWebsite("http://www.atwellpeak.ca/about")).toBe("http://www.atwellpeak.ca/about");
    expect(cleanWebsite("not a site")).toBeNull();
    expect(cleanWebsite("")).toBeNull();
  });

  it("needs a business, a name, a mobile, a website or town, and consent", () => {
    expect(demoRequestProblem(ok, true)).toBeNull();
    expect(demoRequestProblem({ ...ok, website: "", city: "Squamish" }, true)).toBeNull();
    expect(demoRequestProblem({ ...ok, website: "", city: "" }, true)).toMatch(/website, or at least your town/);
    expect(demoRequestProblem({ ...ok, website: "nope nope" }, true)).toMatch(/website address/);
    expect(demoRequestProblem(ok, false)).toMatch(/mobile number/);
    expect(demoRequestProblem({ ...ok, consent: false }, true)).toMatch(/Tick the box/);
    expect(demoRequestProblem({ ...ok, business: " " }, true)).toMatch(/business name/);
  });

  it("texts the number and extension, with an opt-out", () => {
    const t = demoReadyText({ firstName: "Dana Lee", business: "Atwell Peak Contracting", agent: "Ava", number: "(778) 650-4870", extension: "142" });
    expect(t).toMatch(/^Hi Dana, /);
    expect(t).toContain("(778) 650-4870");
    expect(t).toContain("extension 142");
    expect(t).toContain("Reply STOP");
    expect(demoDelayedText("", "Atwell Peak")).toMatch(/^Hi, .*Reply STOP/);
  });
});

describe("website copy", async () => {
  const { INDUSTRIES, PLAN_NAME } = await import("@/lib/site-content");
  const { GUIDES } = await import("@/lib/seo");
  const { FAQ } = await import("@/lib/site-faq");

  it("labels every price in search snippets and keeps one plan name", () => {
    for (const ind of Object.values(INDUSTRIES)) {
      expect(ind.seo.description).toMatch(/CA\$\d+\/month \(US\$\d+\)/);
      expect(ind.seo.description).not.toMatch(/(^|\s)\$\d/);
    }
    expect(PLAN_NAME).toBe("Receptionist Plan");
  });

  it("speaks to stores and salons on the retail page, not the trades", () => {
    const r = INDUSTRIES.retail;
    const text = JSON.stringify([r.painHeading, r.stepsHeading, r.plan, r.footerTagline, r.steps, r.heroSub]);
    expect(text).not.toMatch(/tools|sub-trade|booked job|trade calls|for the trades/i);
    expect(r.heroSub).toMatch(/salons/);
  });

  it("uses invented addresses in the samples", () => {
    expect(JSON.stringify(INDUSTRIES.contractors.simulation)).not.toMatch(/38030|7th Ave/);
  });

  it("has the new guides and the FAQ owners asked for", () => {
    for (const slug of ["hvac-after-hours-emergency-calls", "storm-week-call-spikes", "winter-tire-season-booking", "voicemail-greeting-script"]) expect(GUIDES.some((g) => g.slug === slug)).toBe(true);
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
    const qs = FAQ.map((f) => f.q).join(" | ");
    for (const q of ["know it's AI", "transfer", "gets something wrong", "keep my business number", "cancel"]) expect(qs).toContain(q);
  });
});

describe("demo cost controls", async () => {
  const { conversationLimits, DEMO_MAX_CALL_MINUTES } = await import("@/lib/call-guard-rules");
  const { idleDays, shouldExpire, websiteBuilt, WEBSITE_DEMO_IDLE_DAYS, DEMO_IDLE_DAYS } = await import("@/lib/agent-lifecycle-rules");
  const { DEMO_BUILDS_PER_HOUR } = await import("@/lib/demo-request-rules");

  it("ends demo calls at 5 minutes, and leaves live lines alone", () => {
    expect(DEMO_MAX_CALL_MINUTES).toBe(5);
    expect(conversationLimits({ maxCallMinutes: 10, lifecycle: "demo" }).conversation.max_duration_seconds).toBe(300);
    expect(conversationLimits({ maxCallMinutes: 3, lifecycle: "demo" }).conversation.max_duration_seconds).toBe(180);
    expect(conversationLimits({ maxCallMinutes: 15, lifecycle: "production" }).conversation.max_duration_seconds).toBe(900);
    expect(conversationLimits({ maxCallMinutes: 10 }).conversation.max_duration_seconds).toBe(600);
  });

  it("expires website-built demos after 14 idle days, others after 30", () => {
    expect(websiteBuilt("website,hear-it,contractors")).toBe(true);
    expect(websiteBuilt("website,demo")).toBe(false);
    expect(websiteBuilt(null)).toBe(false);
    expect(idleDays({ fromWebsite: true })).toBe(WEBSITE_DEMO_IDLE_DAYS);
    expect(idleDays({})).toBe(DEMO_IDLE_DAYS);
    const base = { lifecycle: "demo", createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"), lastCallAt: null, accountStage: "PROSPECT", promoted: false };
    const day20 = new Date("2026-11-21");
    expect(shouldExpire({ ...base, fromWebsite: true }, day20)).toBe(true);
    expect(shouldExpire(base, day20)).toBe(false);
    expect(shouldExpire({ ...base, fromWebsite: true, accountStage: "DEMO" }, day20)).toBe(false);
  });

  it("builds at most 6 website demos an hour", () => {
    expect(DEMO_BUILDS_PER_HOUR).toBe(6);
  });
});

describe("Grace and prospects' demos", async () => {
  const { demoEndReason, demoProspectOpening, demoReturnOpening, DEMO_TIMEOUT_SLACK_SECONDS } = await import("@/lib/house-line-rules");
  const t0 = 1_800_000_000_000;

  it("tells a demo that ran out of time from one that finished, failed or was hung up", () => {
    expect(demoEndReason(t0, t0 + 300_000, 5, "in-progress")).toBe("timeout");
    expect(demoEndReason(t0, t0 + (300 - DEMO_TIMEOUT_SLACK_SECONDS) * 1000, 5, "in-progress")).toBe("timeout");
    expect(demoEndReason(t0, t0 + (300 - DEMO_TIMEOUT_SLACK_SECONDS - 1) * 1000, 5, "in-progress")).toBe("ended");
    expect(demoEndReason(t0, t0 + 120_000, 5, "in-progress")).toBe("ended");
    expect(demoEndReason(t0, t0 + 5_000, 5, "in-progress")).toBe("failed");
    expect(demoEndReason(t0, t0 + 300_000, 5, "completed")).toBe("ended");
    expect(demoEndReason(NaN, t0, 5, "in-progress")).toBe("ended");
    expect(demoEndReason(t0, t0 + 175_000, 3, undefined)).toBe("timeout");
  });

  it("greets a prospect with a demo by name and offers it", () => {
    const o = demoProspectOpening({ firstName: "Dana Lee", company: "Head Above Digital", receptionist: "Grace", demoBusiness: "Atwell Peak Contracting" });
    expect(o).toBe("Hi Dana, thanks for calling Head Above Digital, it's Grace. How can I help? And your demo receptionist for Atwell Peak Contracting is set up, if you'd like to try it.");
    expect(demoProspectOpening({ firstName: "", company: "Head Above Digital", receptionist: "Grace", demoBusiness: "X" })).toMatch(/^Hi there, /);
  });

  it("comes back after the demo to book a follow-up", () => {
    expect(demoReturnOpening({ firstName: "Dana", company: "Head Above Digital", receptionist: "Grace" })).toMatch(/^Hi again, Dana, it's Grace.*end of the demo time.*book a quick call/);
    expect(demoReturnOpening({ company: "Head Above Digital", receptionist: "Grace", failed: true })).toMatch(/^Sorry about that, the demo didn't connect/);
  });
});
