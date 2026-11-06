import { describe, expect, it } from "vitest";
import { brandedHtml, brandFromHtml, icsFile, mimeBody, safeColor, safeLogo } from "@/lib/email-brand";

describe("branded booking emails", () => {
  it("lays out the message in the client's brand, escaping everything", () => {
    const html = brandedHtml({ businessName: "Coast <Plumbing>", logoUrl: "https://coast.example/logo.png", color: "#0a5", signOff: "Dana & the team" }, "Hi Sam,\n\nYou're booked.\nSee you then.");
    expect(html).toContain('src="https://coast.example/logo.png"');
    expect(html).toContain("Coast &lt;Plumbing&gt;");
    expect(html).toContain("You&#39;re booked.".replace("&#39;", "'"));
    expect(html).toContain("See you then.");
    expect(html).toContain("Dana &amp; the team");
    expect(html).toContain("#0a5");
  });

  it("only uses safe colours and https logos", () => {
    expect(safeColor("red; background:url(x)")).toBe("#1F3B2D");
    expect(safeColor("#ABCDEF")).toBe("#ABCDEF");
    expect(safeLogo("http://x.example/a.png")).toBeNull();
    expect(safeLogo("javascript:alert(1)")).toBeNull();
    expect(brandedHtml({ businessName: "X", logoUrl: "javascript:alert(1)" }, "Hi")).not.toContain("javascript:");
  });

  it("builds a calendar file any calendar can add", () => {
    const ics = icsFile([{ uid: "b1@headabove", start: new Date("2026-11-10T17:00:00Z"), end: new Date("2026-11-10T17:30:00Z"), title: "Estimate, Coast Plumbing", description: "We'll call you; bring photos" }], { name: "Coast Plumbing" }, new Date("2026-11-06T00:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("DTSTART:20261110T170000Z");
    expect(ics).toContain("SUMMARY:Estimate\\, Coast Plumbing");
    expect(ics).toContain("DESCRIPTION:We'll call you\\; bring photos");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });

  it("builds text + HTML + attachment parts", () => {
    const m = mimeBody({ text: "Hi", html: "<p>Hi</p>", attachments: [{ filename: "invite.ics", contentType: "text/calendar; method=PUBLISH", content: "BEGIN:VCALENDAR" }] }, "x");
    expect(m.contentType).toBe('multipart/mixed; boundary="mix_x"');
    expect(m.body).toContain('Content-Type: multipart/alternative; boundary="alt_x"');
    expect(m.body).toContain("Content-Type: text/html");
    expect(m.body).toContain('filename="invite.ics"');
    expect(m.body.trim().endsWith("--mix_x--")).toBe(true);
    expect(mimeBody({ text: "Plain" }).contentType).toContain("text/plain");
  });

  it("finds the logo and brand colour on a website", () => {
    const html = `<head><meta name="theme-color" content="#123456"><link rel="apple-touch-icon" href="/apple.png"><meta property="og:image" content="https://cdn.example/og.jpg"></head><body><img class="site-logo" src="/img/logo.png" alt="Coast"></body>`;
    expect(brandFromHtml(html, "https://coast.example/")).toEqual({ logoUrl: "https://coast.example/img/logo.png", color: "#123456" });
    expect(brandFromHtml(`<link rel="apple-touch-icon" href="/a.png">`, "https://c.example").logoUrl).toBe("https://c.example/a.png");
    expect(brandFromHtml(`<meta name="theme-color" content="blue">`, "https://c.example")).toEqual({ logoUrl: null, color: null });
  });
});
