import { describe, expect, it } from "vitest";
import { cleanAppUrl, twilioSignedUrls } from "../src/lib/app-url";

describe("cleanAppUrl", () => {
  it("removes the usual slips", () => {
    expect(cleanAppUrl("https://app.headabovedigital.com,")).toBe("https://app.headabovedigital.com");
    expect(cleanAppUrl(" https://dawnpatrol-three.vercel.app/ ")).toBe("https://dawnpatrol-three.vercel.app");
    expect(cleanAppUrl("https://a.example.com, https://b.example.com")).toBe("https://a.example.com");
    expect(cleanAppUrl("not a url")).toBe("");
    expect(cleanAppUrl(undefined)).toBe("");
  });
});

describe("twilioSignedUrls", () => {
  it("tries APP_URL and the host the request came in on", () => {
    expect(twilioSignedUrls("/api/voice/demo?attempt=1", "dawnpatrol-three.vercel.app", "https://app.headabovedigital.com")).toEqual([
      "https://app.headabovedigital.com/api/voice/demo?attempt=1",
      "https://dawnpatrol-three.vercel.app/api/voice/demo?attempt=1",
    ]);
    expect(twilioSignedUrls("/x", "app.headabovedigital.com", "https://app.headabovedigital.com")).toEqual(["https://app.headabovedigital.com/x"]);
    expect(twilioSignedUrls("/x", "evil.com/../", "https://a.com")).toEqual(["https://a.com/x"]);
  });
});
