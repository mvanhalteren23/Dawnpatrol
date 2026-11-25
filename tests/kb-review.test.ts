import { describe, expect, it } from "vitest";
import { confirmedFields, groupForReview, linkState, placeholderHint, reviewKind, validToken } from "@/lib/kb-review-rules";

const item = (o: Partial<{ id: string; category: string; title: string; content: string; tags: string; isActive: boolean }>) => ({ id: "i", category: "FAQ", title: "T", content: "C", tags: "", isActive: true, ...o });

describe("client knowledge review", () => {
  it("puts each entry in the right section", () => {
    expect(reviewKind(item({ content: "TO FILL IN: Opening hours for each day.", isActive: false, tags: "template" }))).toBe("fill");
    expect(reviewKind(item({ tags: "demo-research,assumed" }))).toBe("check");
    expect(reviewKind(item({ tags: "claude-draft", isActive: false }))).toBe("suggestion");
    expect(reviewKind(item({ tags: "demo-research" }))).toBe("live");
    const g = groupForReview([item({ id: "b", category: "SERVICE" }), item({ id: "a", category: "FAQ" }), item({ id: "c", content: "TO FILL IN x" })]);
    expect(g.fill.map((i) => i.id)).toEqual(["c"]);
    expect(g.live.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("shows the hint from a placeholder", () => {
    expect(placeholderHint("TO FILL IN: Street address, parking, and the areas the business serves.")).toBe("Street address, parking, and the areas the business serves.");
  });

  it("confirms an entry once the client saves it", () => {
    const f = confirmedFields({ title: "Payment methods (assumed)", tags: "demo-research,assumed" }, { title: "Payment methods (assumed)", content: " Cards and e-transfer. " });
    expect(f).toEqual({ title: "Payment methods", content: "Cards and e-transfer.", tags: "demo-research,client-reviewed", isActive: true });
    expect(confirmedFields({ title: "x", tags: "claude-draft" }, { title: "x", content: "y" }).tags).toBe("client-reviewed");
  });

  it("knows when a link stops working", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(linkState({ expiresAt: new Date("2026-12-01"), revokedAt: null }, now)).toBe("active");
    expect(linkState({ expiresAt: new Date("2026-11-01"), revokedAt: null }, now)).toBe("expired");
    expect(linkState({ expiresAt: new Date("2026-12-01"), revokedAt: now }, now)).toBe("revoked");
    expect(validToken("short")).toBe(false);
    expect(validToken("a".repeat(32))).toBe(true);
    expect(validToken("../../etc/passwd-aaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

import { neededForReview, reviewPriority } from "@/lib/kb-review-rules";

describe("review order", () => {
  it("asks for what callers need most first", () => {
    const items = [
      item({ id: "warranty", category: "POLICY", title: "Warranty (assumed)", tags: "assumed" }),
      item({ id: "hours", category: "HOURS", title: "Business hours", content: "TO FILL IN: Opening hours for each day.", isActive: false }),
      item({ id: "pay", category: "FAQ", title: "Payment methods (assumed)", tags: "assumed" }),
      item({ id: "area", category: "LOCATION", title: "Address and service area", content: "TO FILL IN: Street address and the areas served.", isActive: false }),
      item({ id: "services", category: "SERVICE", title: "Services offered", content: "TO FILL IN: The work done.", isActive: false }),
      item({ id: "live", category: "HOURS", title: "Holiday hours" }),
    ];
    expect(neededForReview(items).map((i) => i.id)).toEqual(["hours", "services", "area", "pay", "warranty"]);
    expect(reviewPriority(item({ category: "OTHER", title: "Do you do emergency calls?" }))).toBe(78);
    expect(reviewPriority(item({ category: "FAQ", title: "Parking" }))).toBe(90);
  });
});
