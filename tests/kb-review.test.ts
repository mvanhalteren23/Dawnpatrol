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
