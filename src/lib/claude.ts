import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { companyName } from "./brand";

// All Claude calls live here. Research and prospecting use server-side web search/fetch,
// followed by a cheap structured-extraction pass so the CRM gets typed fields back.

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// Server-side refusal fallback: if the model declines, the API re-runs on its recommended
// fallback model inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  client ??= new Anthropic();
  return client;
}

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type ClaudeResult = { text: string; model: string; tokensIn: number; tokensOut: number };

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function assertNotRefused(message: Anthropic.Beta.BetaMessage) {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "unspecified";
    throw new Error(`Claude declined this request (${category}). Try rephrasing the prompt.`);
  }
}

const researchSystem = (company: string) => `You are the research analyst for ${company}, which builds AI receptionists for small and medium businesses so they never miss a call or lose a customer.
Research with the web tools, verify facts against the business's own website when possible, and cite sources inline as markdown links.
Write in clean markdown with short sections. Say "unknown" instead of guessing.`;

/** Web-enabled research. Streams under the hood (long tool loops) and resumes pause_turn. */
export async function runWebResearch(prompt: string, opts: { maxSearches?: number; system?: string } = {}): Promise<ClaudeResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let tokensIn = 0;
  let tokensOut = 0;
  let final: Anthropic.Beta.BetaMessage | null = null;

  for (let continuation = 0; continuation < 5; continuation++) {
    const stream = anthropic().beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: opts.system ?? researchSystem(await companyName()),
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 8 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
      ],
      messages,
    });
    final = await stream.finalMessage();
    tokensIn += final.usage.input_tokens;
    tokensOut += final.usage.output_tokens;
    assertNotRefused(final);
    if (final.stop_reason !== "pause_turn") break;
    // Server tool loop hit its iteration cap — send the partial turn back and it resumes.
    if (messages.length === 1) messages.push({ role: "assistant", content: final.content });
    else messages[1] = { role: "assistant", content: final.content };
  }
  if (!final) throw new Error("No response from Claude");
  return { text: textOf(final.content), model: final.model, tokensIn, tokensOut };
}

async function extract<T extends z.ZodType>(schema: T, instructions: string, source: string): Promise<{ data: z.infer<T>; tokensIn: number; tokensOut: number }> {
  const response = await anthropic().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: `${instructions}\n\n<source>\n${source}\n</source>` }],
  });
  assertNotRefused(response);
  if (response.parsed_output == null) throw new Error("Claude returned output that did not match the expected format");
  return { data: response.parsed_output as z.infer<T>, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
}

// --- Account research --------------------------------------------------------

export const ResearchSummarySchema = z.object({
  fitScore: z.number().int().describe("0-100: how well this business fits an AI receptionist (call-dependent, misses calls, can pay ~$300-1000/mo)"),
  estMissedCallsPerWeek: z.number().int().nullable(),
  avgJobValueUsd: z.number().nullable(),
  industry: z.string().nullable(),
  website: z.string().nullable().describe("The business's own website URL, if found"),
  city: z.string().nullable(),
  state: z.string().nullable(),
  phone: z.string().nullable(),
  employees: z.number().int().nullable(),
  keyFacts: z.array(z.string()).describe("3-6 short bullet facts"),
  painSignals: z.array(z.string()).describe("Evidence that calls or leads are being missed"),
  decisionMakers: z.array(z.object({
    name: z.string(),
    title: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    linkedin: z.string().nullable(),
  })),
  suggestedOpener: z.string().describe("One-sentence personalised opener for outreach"),
});
export type ResearchSummary = z.infer<typeof ResearchSummarySchema>;

export async function researchAccount(renderedPrompt: string): Promise<ClaudeResult & { summary: ResearchSummary | null }> {
  const report = await runWebResearch(renderedPrompt);
  let summary: ResearchSummary | null = null;
  let tokensIn = report.tokensIn;
  let tokensOut = report.tokensOut;
  try {
    const ex = await extract(ResearchSummarySchema, "Extract the structured fields from this research report. Use null where the report doesn't say. Only include decision makers named in the report.", report.text);
    summary = ex.data;
    tokensIn += ex.tokensIn;
    tokensOut += ex.tokensOut;
  } catch (err) {
    console.error("research extraction failed", err);
  }
  return { ...report, tokensIn, tokensOut, summary };
}

// --- Prospect discovery ------------------------------------------------------

export const ProspectSchema = z.object({
  name: z.string(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  industry: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  employees: z.number().int().nullable(),
  fitScore: z.number().int().describe("0-100"),
  whyFit: z.string().describe("One or two sentences: why this business needs an AI receptionist"),
  contactName: z.string().nullable(),
  contactTitle: z.string().nullable(),
  contactEmail: z.string().nullable(),
  sourceUrl: z.string().nullable(),
});
export type Prospect = z.infer<typeof ProspectSchema>;
const ProspectListSchema = z.object({ prospects: z.array(ProspectSchema) });

export async function discoverProspects(renderedPrompt: string, count: number): Promise<ClaudeResult & { prospects: Prospect[] }> {
  const report = await runWebResearch(
    `${renderedPrompt}\n\nReturn a markdown table of up to ${count} businesses with: name, website, phone, city, state, industry, approximate employees, decision maker (name/title/email if public), a fit score 0-100, why they fit, and the source URL.`,
    { maxSearches: Math.min(20, Math.max(5, Math.ceil(count / 2))) },
  );
  const ex = await extract(ProspectListSchema, "Convert every business listed in this prospect report into the structured list. Do not add businesses that are not in the report.", report.text);
  return {
    ...report,
    tokensIn: report.tokensIn + ex.tokensIn,
    tokensOut: report.tokensOut + ex.tokensOut,
    prospects: ex.data.prospects.slice(0, count),
  };
}

// --- Knowledge base drafting (onboarding) --------------------------------------

export const KbDraftSchema = z.object({
  items: z.array(z.object({
    category: z.enum(["FAQ", "SERVICE", "PRICING", "HOURS", "LOCATION", "POLICY", "STAFF", "SCRIPT", "OTHER"]),
    title: z.string(),
    content: z.string(),
  })),
});
export type KbDraft = z.infer<typeof KbDraftSchema>["items"];

export async function draftKnowledgeBase(businessName: string, website: string, notes: string): Promise<ClaudeResult & { items: KbDraft }> {
  const report = await runWebResearch(
    `Build a phone-receptionist knowledge base for ${businessName} from their website ${website} (fetch the homepage and the services, about, contact, FAQ and pricing pages if they exist).
Capture: services offered, service area and locations, hours, pricing or "starting at" prices if published, booking process, policies (cancellations, warranties, payment, emergencies), staff/departments a caller might ask for, and the questions callers most likely ask with answers.
Write each fact so a receptionist can say it out loud. Only include what the site states.
Additional notes from the client: ${notes || "none"}`,
    { maxSearches: 4 },
  );
  const ex = await extract(KbDraftSchema, "Split this knowledge base into individual entries. Each entry: a category, a short title (for FAQs, the caller's question), and the content to say. Keep facts exactly as written.", report.text);
  return { ...report, tokensIn: report.tokensIn + ex.tokensIn, tokensOut: report.tokensOut + ex.tokensOut, items: ex.data.items };
}

// --- Outreach drafting -------------------------------------------------------

const EmailDraftSchema = z.object({ subject: z.string(), body: z.string() });

export async function draftOutreachEmail(renderedPrompt: string, researchContext: string): Promise<{ subject: string; body: string }> {
  const ex = await extract(
    EmailDraftSchema,
    `${renderedPrompt}\n\nUse the account research below for personalisation. Body is plain text with line breaks; sign off as the ${await companyName()} team.`,
    researchContext || "No research available.",
  );
  return ex.data;
}

// --- Receptionist test chat (Claude as the RAG consumer) ------------------------

export async function receptionistReply(
  systemPrompt: string,
  knowledgeBase: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const response = await anthropic().beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low" },
    // Stable prefix (prompt + KB) is cached; the conversation varies after it.
    system: [
      { type: "text", text: systemPrompt },
      {
        type: "text",
        text: `<knowledge_base>\n${knowledgeBase || "(empty)"}\n</knowledge_base>\n\nThis is a phone call transcript; reply with exactly what you would say. Latency-sensitive; begin your answer immediately.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
  assertNotRefused(response);
  return textOf(response.content);
}
