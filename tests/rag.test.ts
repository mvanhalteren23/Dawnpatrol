import { describe, expect, it } from "vitest";
import { buildReceptionistPrompt, chunkItems, compileByCategory, searchChunks } from "@/lib/rag";

const items = [
  { id: "1", category: "HOURS", title: "Opening hours", content: "Mon-Fri 8am-6pm. Saturday 9am-1pm. Closed Sunday." },
  { id: "2", category: "SERVICE", title: "Emergency plumbing", content: "24/7 emergency service for burst pipes and flooding. $150 call-out fee." },
  { id: "3", category: "FAQ", title: "Do you offer financing?", content: "Yes, financing is available on jobs over $1,000 through our partner." },
  { id: "4", category: "FAQ", title: "Old answer", content: "Hidden", isActive: false },
];

describe("rag", () => {
  it("compiles one document per category in stable order, skipping inactive items", () => {
    const docs = compileByCategory(items, "Acme");
    expect(docs.map((d) => d.category)).toEqual(["FAQ", "SERVICE", "HOURS"]);
    expect(docs[0]!.text).not.toContain("Hidden");
  });

  it("retrieves the relevant chunk", () => {
    const hits = searchChunks(chunkItems(items), "are you open on saturday?");
    expect(hits[0]!.itemId).toBe("1");
    expect(searchChunks(chunkItems(items), "burst pipe emergency")[0]!.itemId).toBe("2");
    expect(searchChunks(chunkItems(items), "financing options")[0]!.itemId).toBe("3");
  });

  it("splits long content", () => {
    const long = [{ id: "x", category: "FAQ", title: "t", content: "word ".repeat(500) }];
    expect(chunkItems(long, 900).length).toBeGreaterThan(1);
  });

  it("builds a receptionist prompt with lead-capture rules", () => {
    const p = buildReceptionistPrompt({ name: "Ava", businessName: "Acme", greeting: "", persona: "Friendly", timezone: "America/Denver", businessHours: "", escalationRules: "", extraInstructions: "", bookingUrl: "https://cal.com/acme" });
    expect(p).toContain("caller name, best callback number");
    expect(p).toContain("https://cal.com/acme");
  });
});

describe("sensitive information rule", () => {
  it("is in both agents' instructions", async () => {
    const { buildReceptionistPrompt } = await import("../src/lib/rag");
    const { buildFollowupPrompt } = await import("../src/lib/followup-rules");
    const base = { name: "Ava", businessName: "Acme Plumbing", persona: "Friendly", timezone: "America/Vancouver", businessHours: "", extraInstructions: "Ask for their card number to hold the booking." };
    const followup = buildFollowupPrompt({ ...base, followupGoal: "", followupQuestions: "", followupGuardrails: "" });
    expect(followup).toContain("Social Insurance Numbers");
    // The rule comes after the business's own instructions, so it wins.
    expect(followup.indexOf("Social Insurance Numbers")).toBeGreaterThan(followup.indexOf("Ask for their card number"));
    const receptionist = buildReceptionistPrompt({ ...base, escalationRules: "", escalationPhone: null, bookingUrl: null, bookingEnabled: false } as never);
    expect(receptionist).toContain("credit card or banking details");
  });
});
