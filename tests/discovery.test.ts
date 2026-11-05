import { describe, expect, it } from "vitest";
import { answersToKnowledge, cleanQuestions, MAX_DISCOVERY_QUESTIONS, parseAnswers, pickDiscoveryQuestions, TRADE_QUESTIONS, tradeFor } from "@/lib/discovery-rules";
import { buildReceptionistPrompt } from "@/lib/rag";

describe("personalization questions", () => {
  it("picks the trade set from the industry or the caller's description", () => {
    expect(tradeFor("Auto Repair")).toBe("mechanics");
    expect(tradeFor("Tire and brake shop")).toBe("mechanics");
    expect(tradeFor("Plumbing & Heating")).toBe("contractors");
    expect(tradeFor("Hair salon")).toBe("retail");
    expect(tradeFor("Accounting")).toBe("general");
    expect(tradeFor(null)).toBe("general");
  });

  it("uses research's questions when the account has them, else the trade set", () => {
    const researched = pickDiscoveryQuestions({ discoveryQuestions: JSON.stringify(["Do you service Subarus", "Do you service Subarus?", "Do you offer a shuttle in Langley?"]), industry: "Auto repair" });
    expect(researched.source).toBe("research");
    expect(researched.questions).toEqual(["Do you service Subarus?", "Do you offer a shuttle in Langley?"]);
    const fallback = pickDiscoveryQuestions({ discoveryQuestions: "", industry: null }, "roofing");
    expect(fallback).toMatchObject({ source: "trade", trade: "contractors" });
    expect(fallback.questions).toEqual(TRADE_QUESTIONS.contractors);
    expect(pickDiscoveryQuestions(null).questions).toHaveLength(MAX_DISCOVERY_QUESTIONS);
    expect(pickDiscoveryQuestions({ discoveryQuestions: "not json", industry: "retail" }).source).toBe("trade");
  });

  it("caps and cleans research questions", () => {
    expect(cleanQuestions(["a", 7, ...Array.from({ length: 8 }, (_, i) => `Question number ${i}`)])).toHaveLength(MAX_DISCOVERY_QUESTIONS);
    expect(cleanQuestions("nope")).toEqual([]);
  });

  it("parses the agent's answers and drops skipped ones", () => {
    const answers = parseAnswers([
      "- Do you work on diesels? Yes, light-duty diesel only",
      "Which areas do you cover: Langley and Surrey",
      "Q: Do you offer loaners?",
      "A: Two loaner cars, book ahead",
      "Do you do financing? skipped",
      "What's your warranty? N/A",
    ].join("\n"));
    expect(answers).toEqual([
      { question: "Do you work on diesels?", answer: "Yes, light-duty diesel only" },
      { question: "Which areas do you cover", answer: "Langley and Surrey" },
      { question: "Do you offer loaners?", answer: "Two loaner cars, book ahead" },
    ]);
    expect(parseAnswers("")).toEqual([]);
  });

  it("builds one knowledge entry from the answers", () => {
    const kb = answersToKnowledge([{ question: "Do you work on diesels?", answer: "Light-duty only" }], "Sam", new Date("2026-11-04T18:00:00Z"));
    expect(kb.title).toBe("From the owner (call on 2026-11-04)");
    expect(kb.content).toContain("What Sam told us");
    expect(kb.content).toContain("Q: Do you work on diesels?\nA: Light-duty only");
  });
});

describe("company receptionist prompt", () => {
  const base = { name: "Ava", businessName: "Head Above Digital", greeting: "", persona: "Friendly", timezone: "America/Vancouver", businessHours: "", escalationRules: "", extraInstructions: "" };

  it("only sells demos on the company's own line", () => {
    expect(buildReceptionistPrompt(base)).not.toContain("get_personalization_questions");
    const own = buildReceptionistPrompt({ ...base, bookingAddsToCrm: true, bookingEnabled: true });
    expect(own).toContain("Your main goal: book a demo.");
    expect(own).toContain("up to five quick questions");
    expect(own).toContain("save_personalization_answers");
    expect(own).toContain("take_client_message");
    expect(own).toContain("Book it with the booking tools.");
    expect(buildReceptionistPrompt({ ...base, bookingAddsToCrm: true })).toContain("Collect two preferred times for the demo");
  });
});

describe("website currency", () => {
  it("shows USD to US visitors and CAD to everyone else, with both price lists", async () => {
    const { currencyForCountry, formatMoney, PRICES } = await import("@/lib/site-content");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("us")).toBe("USD");
    expect(currencyForCountry("CA")).toBe("CAD");
    expect(currencyForCountry(null)).toBe("CAD");
    expect(PRICES.CAD).toMatchObject({ monthly: 139, blockPrice: 25 });
    expect(PRICES.USD).toMatchObject({ monthly: 109, blockPrice: 19 });
    expect(formatMoney("USD", 3600)).toBe("US$3,600");
    expect(formatMoney("CAD", 139)).toBe("CA$139");
  });
});
