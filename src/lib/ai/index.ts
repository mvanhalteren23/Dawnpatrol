import "server-only";
import { z } from "zod";
import { companyName } from "../brand";
import * as claude from "./anthropic";
import * as gemini from "./gemini";
import { runTask } from "./router";
import type { ChatTurn, Target, Task, WebResult } from "./types";

// Every AI feature in the CRM goes through here. Each function names its task; the router
// (CRM → Settings → AI models) decides which provider and model runs it.

export { aiConfigured, getRoutes } from "./router";
export type AiResult = WebResult & { provider: string };

const researchSystem = (company: string) => `You are the research analyst for ${company}, which builds AI receptionists for small and medium businesses so they never miss a call or lose a customer.
Research with web search, verify facts against the business's own website when possible, and cite sources inline as markdown links.
Write in clean markdown with short sections. Say "unknown" instead of guessing.`;

async function webResearch(task: Task, prompt: string, limits: { maxSearches: number; maxFetches: number }): Promise<AiResult> {
  const system = researchSystem(await companyName());
  return runTask(task, (t: Target) =>
    t.provider === "gemini" ? gemini.webResearch(t.model, prompt, { system }) : claude.webResearch(t.model, prompt, { system, ...limits }),
  );
}

async function structured<T extends z.ZodType>(task: Task, schema: T, instructions: string, source: string) {
  return runTask(task, (t: Target) =>
    t.provider === "gemini" ? gemini.structured(t.model, schema, instructions, source) : claude.structured(t.model, schema, instructions, source),
  );
}

/** Combine a research step and its extraction step into one run record. */
function combine(report: AiResult, ex: { tokensIn: number; tokensOut: number; model: string; provider: string }): AiResult {
  const model = ex.model === report.model ? report.model : `${report.model} + ${ex.model}`;
  return { ...report, model, tokensIn: report.tokensIn + ex.tokensIn, tokensOut: report.tokensOut + ex.tokensOut };
}

// --- Account research --------------------------------------------------------

export const ResearchSummarySchema = z.object({
  match: z.enum(["confirmed", "not_confirmed"]).describe("Whether the report confirms it found the right business (name plus website, phone or location matching)"),
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

export async function researchAccount(renderedPrompt: string): Promise<AiResult & { summary: ResearchSummary | null }> {
  const report = await webResearch("research", renderedPrompt, { maxSearches: 5, maxFetches: 3 });
  try {
    const ex = await structured("extraction", ResearchSummarySchema, "Extract the structured fields from this research report. Fill a field only when the report states it; use null otherwise. Copy websites, phone numbers, emails and names exactly as written in the report, and never construct or guess them. Only include decision makers named in the report. Set estMissedCallsPerWeek and avgJobValueUsd only if the report gives specific evidence for them, otherwise null. Set match to not_confirmed if the report says it couldn't confirm the business.", report.text);
    return { ...combine(report, ex), summary: ex.data };
  } catch (err) {
    console.error("research extraction failed", err);
    return { ...report, summary: null };
  }
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

export async function discoverProspects(renderedPrompt: string, count: number): Promise<AiResult & { prospects: Prospect[] }> {
  const report = await webResearch(
    "prospecting",
    `${renderedPrompt}\n\nReturn a markdown table of up to ${count} businesses with: name, website, phone, city, state, industry, approximate employees, decision maker (name/title/email if public), a fit score 0-100, why they fit, and the source URL.`,
    { maxSearches: Math.min(12, Math.max(4, Math.ceil(count / 2))), maxFetches: 4 },
  );
  const ex = await structured("extraction", ProspectListSchema, "Convert every business listed in this prospect report into the structured list. Do not add businesses that are not in the report.", report.text);
  return { ...combine(report, ex), prospects: ex.data.prospects.slice(0, count) };
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

export async function draftKnowledgeBase(businessName: string, website: string, notes: string): Promise<AiResult & { items: KbDraft }> {
  const report = await webResearch(
    "kb_draft",
    `Build a phone-receptionist knowledge base for ${businessName} from their website ${website} (fetch the homepage and the services, about, contact, FAQ and pricing pages if they exist).
Capture: services offered, service area and locations, hours, pricing or "starting at" prices if published, booking process, policies (cancellations, warranties, payment, emergencies), staff/departments a caller might ask for, and the questions callers most likely ask with answers.
Write each fact so a receptionist can say it out loud. Only include what the site states.
Additional notes from the client: ${notes || "none"}`,
    { maxSearches: 3, maxFetches: 6 },
  );
  const ex = await structured("extraction", KbDraftSchema, "Split this knowledge base into individual entries. Each entry: a category, a short title (for FAQs, the caller's question), and the content to say. Keep facts exactly as written.", report.text);
  return { ...combine(report, ex), items: ex.data.items };
}

// --- Outreach drafting -------------------------------------------------------

const EmailDraftSchema = z.object({ subject: z.string(), body: z.string() });

export async function draftOutreachEmail(renderedPrompt: string, researchContext: string): Promise<{ subject: string; body: string }> {
  const ex = await structured(
    "outreach",
    EmailDraftSchema,
    `${renderedPrompt}\n\nUse the account research below for personalisation. Body is plain text with line breaks; sign off as the ${await companyName()} team.`,
    researchContext || "No research available.",
  );
  return ex.data;
}

// --- Receptionist test chat ---------------------------------------------------

export async function receptionistReply(systemPrompt: string, knowledgeBase: string, history: ChatTurn[]): Promise<string> {
  const context = `<knowledge_base>\n${knowledgeBase || "(empty)"}\n</knowledge_base>\n\nThis is a phone call transcript; reply with exactly what you would say. Latency-sensitive; begin your answer immediately.`;
  const res = await runTask("test_chat", (t: Target) =>
    t.provider === "gemini" ? gemini.chat(t.model, systemPrompt, context, history) : claude.chat(t.model, systemPrompt, context, history),
  );
  return res.text;
}

// --- Caller follow-ups -------------------------------------------------------

const CallerSummarySchema = z.object({
  subject: z.string().describe("Short email subject, e.g. 'Your call with Acme Plumbing'"),
  body: z.string().describe("The message to the caller, in plain text"),
});

/** A short, caller-facing recap of a phone call ("you asked…, we'll…"), for a text or an email. */
export async function callerFollowUp(businessName: string, transcript: string, channel: "sms" | "email"): Promise<{ subject: string; body: string }> {
  const ex = await structured(
    "caller_summary",
    CallerSummarySchema,
    `Write the follow-up ${businessName} sends a caller after this phone call with its receptionist. Address the caller directly ("you"), in a warm, plain, brief tone with no praise or filler. Cover what they called about, anything that was answered or arranged (with exact days, times and contact details as stated in the call), and what happens next. Never add facts, prices or promises that aren't in the transcript. ${
      channel === "sms" ? "It's a text message: at most 3 short sentences, under 300 characters, no greeting line, sign off with the business name." : "It's an email: a greeting with their name if known, 2-4 short paragraphs or a few bullet points, then sign off as the " + businessName + " team."
    }`,
    transcript,
  );
  return ex.data;
}
