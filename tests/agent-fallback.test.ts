import { describe, expect, it } from "vitest";
import { agentDropped, numbersMissingFallback, withAfterAgent } from "@/lib/agent-fallback-rules";

describe("when the voice agent can't take a call", () => {
  const handoff = `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://api.elevenlabs.io/v1/convai/conversation"><Parameter name="a" value="b"/></Stream></Connect></Response>`;

  it("attaches the what-next address to the hand-off", () => {
    const out = withAfterAgent(handoff, "https://x.test/api/voice/after-agent?r=abc&t=123");
    expect(out).toContain(`<Connect action="https://x.test/api/voice/after-agent?r=abc&amp;t=123" method="POST"><Stream`);
    expect(out.match(/<Connect/g)?.length).toBe(1);
  });

  it("leaves other answers alone", () => {
    const own = `<Response><Connect action="https://e.test/done"><Stream url="wss://e"/></Connect></Response>`;
    expect(withAfterAgent(own, "https://x.test/a")).toBe(own);
    const sayOnly = `<Response><Say>Hi</Say></Response>`;
    expect(withAfterAgent(sayOnly, "https://x.test/a")).toBe(sayOnly);
  });

  it("treats a hand-off that ends within seconds, caller still there, as a failure", () => {
    const start = 1_000_000;
    expect(agentDropped(start, start + 4_000, "in-progress")).toBe(true);
    expect(agentDropped(start, start + 4_000, undefined)).toBe(true);
    expect(agentDropped(start, start + 90_000, "in-progress")).toBe(false); // a normal call that ended
    expect(agentDropped(start, start + 4_000, "completed")).toBe(false); // the caller hung up
    expect(agentDropped(NaN, start, "in-progress")).toBe(false);
  });

  it("finds numbers without a backup address", () => {
    const nums = [
      { sid: "PN1", voice_url: "https://x.test/api/voice/business", voice_fallback_url: "" },
      { sid: "PN2", voice_url: "https://x.test/api/voice/demo", voice_fallback_url: "https://x.test/api/voice/fallback" },
      { sid: "PN3", voice_url: "https://other.example/voice", voice_fallback_url: "" },
    ];
    expect(numbersMissingFallback(nums, "https://x.test/")).toEqual(["PN1"]);
  });
});
