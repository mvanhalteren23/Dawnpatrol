import { describe, expect, it } from "vitest";
import { dialableNumber, ringFromForm } from "@/lib/twilio";

const form = (cell: string) => {
  const f = new FormData();
  f.set("ringFirstNumber", cell);
  f.set("ringMode", "always");
  return f;
};

describe("numbers we dial at our expense", () => {
  it("accepts Canadian and US numbers", () => {
    expect(ringFromForm(form("604-966-8897")).ringFirstNumber).toBe("+16049668897");
    expect(dialableNumber("+1 (778) 650-4870")).toBe("+17786504870");
  });
  it("rejects international and premium-rate numbers", () => {
    expect(() => ringFromForm(form("+44 20 7946 0958"))).toThrow();
    expect(() => ringFromForm(form("+882 1234 5678"))).toThrow();
    expect(() => ringFromForm(form("1-900-555-0199"))).toThrow();
    expect(dialableNumber("+1 976 555 0199")).toBeNull();
  });
  it("still allows clearing the number", () => {
    expect(ringFromForm(form("")).ringFirstNumber).toBeNull();
  });
});
