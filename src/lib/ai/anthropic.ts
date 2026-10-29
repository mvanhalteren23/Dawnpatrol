import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { fenceSource, UNTRUSTED_SOURCE_NOTE, type ChatTurn, type Usage, type WebResult } from "./types";

// Claude adapter. Research uses the server-side web_search / web_fetch tools; structured output
// uses a low-effort parse pass. Requests opt in to server-side refusal fallback.

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!anthropicConfigured()) throw new Error("ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic();
  return client;
}

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

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

// Haiku takes the basic web tool versions; Opus/Sonnet take the dynamic-filtering ones.
function webTools(model: string, maxSearches: number, maxFetches: number): Anthropic.Beta.BetaToolUnion[] {
  if (model.includes("haiku")) {
    return [
      { type: "web_search_20250305", name: "web_search", max_uses: maxSearches },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: maxFetches, max_content_tokens: 8000 },
    ];
  }
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: maxSearches },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxFetches, max_content_tokens: 8000 },
  ];
}

/** Web research. Streams under the hood (long tool loops) and resumes pause_turn. */
export async function webResearch(model: string, prompt: string, opts: { system: string; maxSearches: number; maxFetches: number }): Promise<WebResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let tokensIn = 0;
  let tokensOut = 0;
  let final: Anthropic.Beta.BetaMessage | null = null;

  for (let continuation = 0; continuation < 5; continuation++) {
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: opts.system,
      tools: webTools(model, opts.maxSearches, opts.maxFetches),
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

export async function structured<T extends z.ZodType>(model: string, schema: T, instructions: string, source: string): Promise<Usage & { data: z.infer<T> }> {
  const response = await anthropic().beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    // Website text and research are untrusted: they go in the user turn as data, the task in the system prompt.
    system: `${instructions}\n\n${UNTRUSTED_SOURCE_NOTE}`,
    messages: [{ role: "user", content: `<source>\n${fenceSource(source)}\n</source>` }],
  });
  assertNotRefused(response);
  if (response.parsed_output == null) throw new Error("Claude returned output that did not match the expected format");
  return { data: response.parsed_output as z.infer<T>, model: response.model, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
}

/** Conversational reply with a cached system prefix (prompt + context), e.g. the receptionist test chat. */
export async function chat(model: string, system: string, context: string, history: ChatTurn[]): Promise<Usage & { text: string }> {
  const response = await anthropic().beta.messages.create({
    model,
    max_tokens: 2000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low" },
    // Stable prefix (prompt + context) is cached; the conversation varies after it.
    system: [
      { type: "text", text: system },
      { type: "text", text: context, cache_control: { type: "ephemeral" } },
    ],
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
  assertNotRefused(response);
  return { text: textOf(response.content), model: response.model, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
}
