import { describe, expect, it } from "vitest";
import { addClosedDates, confirmationText, datesBetween, expiredNote, isOwnerNumber, isUndo, MAX_CLOSED_DAYS, noteTags, ownerNumbers, planProblems, removeClosedDates, type OwnerPlan } from "@/lib/owner-mode-rules";

const plan = (p: Partial<OwnerPlan>): OwnerPlan => ({ action: "closed", startDate: "2026-11-09", endDate: "2026-11-15", startTime: null, endTime: null, title: "Vacation", content: "We're closed for vacation and back on the 16th.", confirm: "Closed Nov 9-15.", question: null, infoCategory: null, routingWho: null, routingCategory: null, routingAction: null, routingTo: null, rule: null, ...p });

describe("owner mode", () => {
  it("recognises owner numbers from the agent and portal logins, in any format", () => {
    const nums = ownerNumbers({ ringFirstNumber: "+16045550100", checkinPhone: null, leadAlertTo: "604-555-0111, " }, ["(250) 555-0122", null]);
    expect(isOwnerNumber("+16045550100", nums)).toBe(true);
    expect(isOwnerNumber("6045550111", nums)).toBe(true);
    expect(isOwnerNumber("+12505550122", nums)).toBe(true);
    expect(isOwnerNumber("+16045559999", nums)).toBe(false);
    expect(isOwnerNumber("", nums)).toBe(false);
  });

  it("lists dates inclusive and caps long ranges", () => {
    expect(datesBetween("2026-11-09", "2026-11-11")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(datesBetween("2026-12-31", null)).toEqual(["2026-12-31"]);
    expect(datesBetween("2026-01-01", "2026-12-31")).toHaveLength(MAX_CLOSED_DAYS);
    expect(datesBetween("bad", null)).toEqual([]);
  });

  it("adds closed dates once and undo removes only what was added", () => {
    const { value, added } = addClosedDates("2026-11-10\n2026-12-25", ["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(added).toEqual(["2026-11-09", "2026-11-11"]);
    expect(removeClosedDates(value, added)).toBe("2026-11-10\n2026-12-25");
  });

  it("checks a plan before applying it", () => {
    expect(planProblems(plan({}), "2026-11-06")).toEqual([]);
    expect(planProblems(plan({ startDate: "2026-11-01", endDate: "2026-11-02" }), "2026-11-06")).toContain("a date that isn't in the past");
    expect(planProblems(plan({ startDate: null }), "2026-11-06")).toContain("which date");
    expect(planProblems(plan({ action: "block", startTime: "16:00", endTime: "14:00" }), "2026-11-06")).toContain("a start and end time");
    expect(planProblems(plan({ action: "block", startTime: "14:00", endTime: "16:00" }), "2026-11-06")).toEqual([]);
    expect(planProblems(plan({ action: "info", content: " " }), "2026-11-06")).toContain("what to tell callers");
    expect(planProblems(plan({ action: "routing", startDate: null, routingCategory: "SUPPLIER", routingAction: "transfer" }), "2026-11-06")).toEqual([]);
    expect(planProblems(plan({ action: "routing", startDate: null, routingWho: "Acme Lumber", routingAction: "message" }), "2026-11-06")).toEqual([]);
    expect(planProblems(plan({ action: "routing", startDate: null }), "2026-11-06")).toContain("which callers it's about");
    expect(planProblems(plan({ action: "routing", startDate: null, routingCategory: "SUPPLIER", routingAction: "transfer", routingTo: "555" }), "2026-11-06")).toContain("the full 10-digit number to put them through to");
  });

  it("dated notes expire after their last day", () => {
    expect(noteTags(plan({}))).toBe("owner-update,until:2026-11-15");
    expect(noteTags(plan({ action: "info" }))).toBe("owner-update");
    expect(expiredNote("owner-update,until:2026-11-15", "2026-11-16")).toBe(true);
    expect(expiredNote("owner-update,until:2026-11-15", "2026-11-15")).toBe(false);
    expect(expiredNote("owner-update", "2030-01-01")).toBe(false);
  });

  it("understands UNDO and always offers it in the confirmation", () => {
    expect(isUndo(" undo ")).toBe(true);
    expect(isUndo("UNDO!")).toBe(true);
    expect(isUndo("undo the closure please")).toBe(false);
    expect(confirmationText({ businessName: "Coast Plumbing", summary: "Closed Nov 9", channel: "call" })).toContain("Reply UNDO");
  });
});
