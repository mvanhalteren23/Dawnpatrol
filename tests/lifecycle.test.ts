import { describe, expect, it } from "vitest";
import { DEMO_IDLE_DAYS, demoExpiresAt, lastActive, PROMOTE_FIELDS, promotedSettings, shouldExpire } from "@/lib/agent-lifecycle-rules";

const day = 86400_000;
const now = new Date("2026-12-01T12:00:00Z");
const base = { lifecycle: "demo", createdAt: new Date(now.getTime() - 60 * day), updatedAt: new Date(now.getTime() - 45 * day), lastCallAt: null, accountStage: "CONTACTED", promoted: false };

describe("demo lifecycle", () => {
  it("counts the latest call or change as activity", () => {
    expect(lastActive(base)).toEqual(base.updatedAt);
    expect(lastActive({ ...base, lastCallAt: new Date(now.getTime() - 2 * day) }).getTime()).toBe(now.getTime() - 2 * day);
  });

  it("expires demos idle for 30 days", () => {
    expect(shouldExpire(base, now)).toBe(true);
    expect(shouldExpire({ ...base, lastCallAt: new Date(now.getTime() - 10 * day) }, now)).toBe(false);
    expect(demoExpiresAt({ ...base, lastCallAt: new Date(now.getTime() - 10 * day) })!.getTime()).toBe(now.getTime() + (DEMO_IDLE_DAYS - 10) * day);
  });

  it("never expires production agents, and keeps demos while the deal is active", () => {
    expect(shouldExpire({ ...base, lifecycle: "production" }, now)).toBe(false);
    expect(shouldExpire({ ...base, lifecycle: "expired" }, now)).toBe(false);
    for (const stage of ["ENGAGED", "DEMO", "PROPOSAL", "ONBOARDING"]) expect(shouldExpire({ ...base, accountStage: stage }, now)).toBe(false);
    expect(shouldExpire({ ...base, accountStage: "LOST" }, now)).toBe(true);
    // Once promoted, the deal stage doesn't keep the old demo around.
    expect(shouldExpire({ ...base, accountStage: "ONBOARDING", promoted: true }, now)).toBe(true);
  });

  it("carries settings, not the demo's line or calendar, into production", () => {
    expect(PROMOTE_FIELDS).not.toContain("demoExtension");
    expect(PROMOTE_FIELDS).not.toContain("googleUserId");
    expect(PROMOTE_FIELDS).not.toContain("businessNumber");
    const demo = Object.fromEntries(PROMOTE_FIELDS.map((f) => [f, `v-${f}`])) as Record<(typeof PROMOTE_FIELDS)[number], string>;
    expect(promotedSettings({ ...demo, demoExtension: "101" } as typeof demo)).toEqual(demo);
  });
});
