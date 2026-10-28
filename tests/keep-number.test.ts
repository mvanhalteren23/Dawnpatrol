import { describe, expect, it } from "vitest";
import { forwardingLoop, forwardingSteps, formatNumber } from "@/lib/keep-number";

const line = "+17786504870";

describe("forwarding steps", () => {
  it("gives mobile users the GSM codes for missed-call forwarding with their ring time", () => {
    const steps = forwardingSteps("telus", "forward_no_answer", line, 20);
    expect(steps[0]!.code).toBe("**004*17786504870**20#");
    expect(steps[1]!.code).toBe("##004#");
  });
  it("forwards every call with **21*", () => {
    expect(forwardingSteps("rogers", "forward_all", line)[0]!.code).toBe("**21*17786504870#");
  });
  it("uses *72 for landlines and app settings for VoIP", () => {
    expect(forwardingSteps("landline", "forward_all", line)[0]!.code).toBe("*72 17786504870");
    expect(forwardingSteps("voip", "forward_no_answer", line)[0]!.text).toContain("(778) 650-4870");
  });
  it("has no forwarding steps for a port", () => {
    expect(forwardingSteps("bell", "port", line)).toEqual([]);
  });
  it("rounds the ring time to what carriers accept", () => {
    expect(forwardingSteps("bell", "forward_no_answer", line, 37)[0]!.code).toBe("**004*17786504870**30#");
  });
  it("formats numbers", () => expect(formatNumber("6049668897")).toBe("(604) 966-8897"));
});

describe("forwarding loop guard", () => {
  it("catches forwarding every call from the cell the line rings first", () => {
    expect(forwardingLoop({ method: "forward_all", existingNumber: "604-966-8897", ringFirstNumber: "+16049668897", ringMode: "always" })).toBe(true);
    expect(forwardingLoop({ method: "forward_all", existingNumber: "604-966-8897", ringFirstNumber: "+16049668897", ringMode: "never" })).toBe(false);
    // Missed-call forwarding loops too: an unanswered ring-first forwards straight back.
    expect(forwardingLoop({ method: "forward_no_answer", existingNumber: "604-966-8897", ringFirstNumber: "+16049668897", ringMode: "always" })).toBe(true);
    expect(forwardingLoop({ method: "forward_no_answer", existingNumber: "604-966-8897", ringFirstNumber: "+16045550199", ringMode: "always" })).toBe(false);
    expect(forwardingLoop({ method: "port", existingNumber: "604-966-8897", ringFirstNumber: "+16049668897", ringMode: "always" })).toBe(false);
  });
});
