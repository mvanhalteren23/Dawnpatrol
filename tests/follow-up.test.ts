import { describe, expect, it } from "vitest";
import { followUpEnabled, pickChannel } from "@/lib/follow-up-rules";

describe("follow-up rules", () => {
  it("turns on per kind", () => {
    expect(followUpEnabled({ followUpOn: "" }, "call")).toBe(false);
    expect(followUpEnabled({ followUpOn: "bookings" }, "booking")).toBe(true);
    expect(followUpEnabled({ followUpOn: "bookings" }, "call")).toBe(false);
    expect(followUpEnabled({ followUpOn: "both" }, "call")).toBe(true);
  });

  it("uses the caller's choice, falling back to the contact we have", () => {
    expect(pickChannel("caller_choice", "email", "604", "a@b.co")).toBe("email");
    expect(pickChannel("caller_choice", "text", "604", "a@b.co")).toBe("sms");
    expect(pickChannel("caller_choice", "email", "604", null)).toBe("sms");
    expect(pickChannel("caller_choice", null, "604", "a@b.co")).toBe(null);
    expect(pickChannel("caller_choice", "none", "604", "a@b.co")).toBe(null);
  });

  it("uses a fixed channel unless the caller declines", () => {
    expect(pickChannel("sms", null, "604", null)).toBe("sms");
    expect(pickChannel("email", "text", "604", "a@b.co")).toBe("email");
    expect(pickChannel("sms", "none", "604", null)).toBe(null);
  });
});
