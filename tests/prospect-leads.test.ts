import { describe, expect, it } from "vitest";
import {
  CALL_LIST_TAG,
  cleanChannels,
  cleanLead,
  mergeLead,
  paidChannelCount,
  parseIntake,
  promotionNotes,
  promotionTags,
  sameBusiness,
  scoreLead,
  type CleanLead,
} from "../src/lib/prospect-leads-rules";

const base = {
  name: "Coast Plumbing & Heating Ltd.",
  website: "https://www.coastplumbing.ca/contact",
  phone: "(604) 555-0142",
  city: "Squamish",
  region: "BC",
  channels: { lsa: true, googleVerified: true },
  evidence: [{ channel: "lsa", note: "Sponsored card for 'plumber Squamish'", url: "https://www.google.com/search?q=plumber+squamish" }],
  signals: ["reviews mention no callback"],
  googleRating: "4.6",
  reviewCount: "87",
};

describe("cleanLead", () => {
  it("normalises the website, keeps the phone and scores paid channels", () => {
    const l = cleanLead(base) as CleanLead;
    expect(l.domain).toBe("coastplumbing.ca");
    expect(l.website).toBe("https://www.coastplumbing.ca/contact");
    expect(l.phone).toBe("(604) 555-0142");
    expect(l.googleRating).toBe(4.6);
    expect(l.reviewCount).toBe(87);
    // LSA 30 + Verified 10 + one signal 5 + under-150 reviews 5
    expect(l.score).toBe(50);
  });
  it("rejects leads with no name, or no website and no usable phone", () => {
    expect(cleanLead({ website: "x.ca" })).toBe("missing name");
    expect(cleanLead({ name: "Joe's", phone: "555-01" })).toMatch(/needs a website/);
    expect(typeof cleanLead({ name: "Joe's", phone: "604 555 0199" })).toBe("object");
  });
  it("drops evidence without a url or note and non-http urls", () => {
    const l = cleanLead({ ...base, evidence: [{ channel: "lsa" }, { channel: "x", url: "javascript:alert(1)", note: "" }, "https://homestars.com/companies/1"] }) as CleanLead;
    expect(l.evidence).toEqual([{ channel: "note", url: "https://homestars.com/companies/1", note: "" }]);
  });
  it("ignores out-of-range ratings", () => {
    expect((cleanLead({ ...base, googleRating: 9 }) as CleanLead).googleRating).toBeNull();
  });
});

describe("channels and scoring", () => {
  it("accepts an object or a list and drops unknown keys", () => {
    expect(cleanChannels(["metaAds", "tiktok"])).toEqual({ metaAds: true });
    expect(cleanChannels({ yelpAds: "yes", lsa: false })).toEqual({ yelpAds: true });
  });
  it("treats a Google Verified badge as a Local Services Ad", () => {
    expect(cleanChannels({ googleVerified: true })).toEqual({ googleVerified: true, lsa: true });
  });
  it("counts HomeStars once when both featured and verified", () => {
    expect(scoreLead({ homestarsFeatured: true, homestarsVerified: true }, [], null)).toBe(20);
  });
  it("caps signals and the total at 100", () => {
    expect(scoreLead({}, ["a", "b", "c", "d", "e", "f"], null)).toBe(20);
    const all = { lsa: true, googleVerified: true, googleSearchAds: true, homestarsFeatured: true, metaAds: true, yelpAds: true, callTracking: true };
    expect(scoreLead(all, ["a", "b", "c", "d"], 10)).toBe(100);
  });
  it("counts paid channels without the badge or tracking number", () => {
    expect(paidChannelCount({ lsa: true, googleVerified: true, callTracking: true, metaAds: true })).toBe(2);
  });
});

describe("parseIntake", () => {
  it("accepts a bare array and merges duplicates within the payload", () => {
    const r = parseIntake([base, { ...base, website: "coastplumbing.ca", channels: { metaAds: true }, signals: ["website promises 24/7"] }, { name: "" }]);
    if (typeof r === "string") throw new Error(r);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]!.channels).toEqual({ lsa: true, googleVerified: true, metaAds: true });
    expect(r.leads[0]!.signals).toEqual(["reviews mention no callback", "website promises 24/7"]);
    expect(r.errors).toEqual([{ index: 2, message: "missing name" }]);
  });
  it("reads the search block and rejects bad shapes", () => {
    const r = parseIntake({ search: { industry: "Plumbing", region: "Squamish, BC" }, leads: [] });
    expect(typeof r !== "string" && r.search).toEqual({ industry: "Plumbing", region: "Squamish, BC" });
    expect(parseIntake({ nope: 1 })).toMatch(/Expected/);
    expect(parseIntake({ leads: Array.from({ length: 201 }, () => base) })).toMatch(/at most/);
  });
});

describe("sameBusiness and mergeLead", () => {
  const a = cleanLead(base) as CleanLead;
  it("matches on website, phone digits, or name in the same city", () => {
    expect(sameBusiness(a, { domain: null, phone: "+1 604-555-0142", name: "Other", city: null })).toBe(true);
    expect(sameBusiness(a, { domain: null, phone: null, name: "Coast Plumbing & Heating", city: "squamish" })).toBe(true);
    expect(sameBusiness(a, { domain: null, phone: null, name: "Coast Plumbing & Heating", city: "Whistler" })).toBe(false);
  });
  it("fills blanks, adds channels and evidence once, and re-scores", () => {
    const next = cleanLead({ name: "Coast Plumbing", phone: "604-555-0142", industry: "Plumbing", channels: { homestarsVerified: true }, evidence: base.evidence }) as CleanLead;
    const m = mergeLead(a, next);
    expect(m.name).toBe(a.name);
    expect(m.industry).toBe("Plumbing");
    expect(m.channels.homestarsVerified).toBe(true);
    expect(m.evidence).toHaveLength(1);
    expect(m.score).toBe(a.score + 15);
  });
});

describe("promotion", () => {
  const a = cleanLead({ ...base, channels: { lsa: true, homestarsFeatured: true, homestarsVerified: true } }) as CleanLead;
  it("tags paid channels once, and call-list only for the dialer", () => {
    expect(promotionTags(a.channels, false)).toEqual(["researched-lead", "paid-lsa", "paid-homestars"]);
    expect(promotionTags(a.channels, true)).toContain(CALL_LIST_TAG);
  });
  it("writes notes with what they pay for and the proof", () => {
    const n = promotionNotes(a, { industry: "Plumbing", region: "Squamish, BC" });
    expect(n).toContain("Researched lead (Plumbing, Squamish, BC).");
    expect(n).toContain("Pays for leads: Google Local Services Ads, HomeStars featured ad, HomeStars Verified (paid member).");
    expect(n).toContain("Google: 4.6★ from 87 reviews.");
    expect(n).toContain("- lsa: Sponsored card for 'plumber Squamish' https://www.google.com/search?q=plumber+squamish");
  });
});
