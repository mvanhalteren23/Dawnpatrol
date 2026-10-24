import "server-only";
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import type { ChatTurn, Usage, WebResult } from "./types";

// Gemini adapter (Gemini Developer API, key from aistudio.google.com). Research is grounded with
// the Google Search and URL context tools; sources come back as grounding metadata.

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY is not configured");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function usage(model: string, res: GenerateContentResponse): Usage {
  const u = res.usageMetadata;
  return { model: res.modelVersion ?? model, tokensIn: u?.promptTokenCount ?? 0, tokensOut: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) };
}

function textOrThrow(res: GenerateContentResponse): string {
  const text = res.text?.trim();
  if (!text) throw new Error(`Gemini returned no text (${res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "unknown reason"})`);
  return text;
}

export async function webResearch(model: string, prompt: string, opts: { system: string }): Promise<WebResult> {
  const res = await gemini().models.generateContent({
    model,
    contents: prompt,
    config: { systemInstruction: opts.system, tools: [{ googleSearch: {} }, { urlContext: {} }] },
  });
  let text = textOrThrow(res);
  // Grounding sources, listed so the report keeps its citations like the Claude path.
  const seen = new Set<string>();
  const sources = (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri) && !seen.has(w!.uri!) && Boolean(seen.add(w!.uri!)));
  if (sources.length) text += `\n\n## Sources\n${sources.map((s) => `- [${s.title || s.uri}](${s.uri})`).join("\n")}`;
  return { text, ...usage(model, res) };
}

export async function structured<T extends z.ZodType>(model: string, schema: T, instructions: string, source: string): Promise<Usage & { data: z.infer<T> }> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  const res = await gemini().models.generateContent({
    model,
    contents: `${instructions}\n\n<source>\n${source}\n</source>`,
    config: { responseMimeType: "application/json", responseJsonSchema: jsonSchema },
  });
  const parsed = schema.safeParse(JSON.parse(textOrThrow(res)));
  if (!parsed.success) throw new Error(`Gemini returned output that did not match the expected format: ${parsed.error.message.slice(0, 300)}`);
  return { data: parsed.data, ...usage(model, res) };
}

export async function chat(model: string, system: string, context: string, history: ChatTurn[]): Promise<Usage & { text: string }> {
  const res = await gemini().models.generateContent({
    model,
    contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    config: { systemInstruction: `${system}\n\n${context}` },
  });
  return { text: textOrThrow(res), ...usage(model, res) };
}

/** Gemini models this key can call for text generation (for the settings dropdown). */
export async function listGeminiModels(): Promise<string[]> {
  if (!geminiConfigured()) return [];
  const out: string[] = [];
  const pager = await gemini().models.list({ config: { pageSize: 100 } });
  for await (const m of pager) {
    if (m.name && (m.supportedActions ?? []).includes("generateContent")) out.push(m.name.replace(/^models\//, ""));
    if (out.length > 200) break;
  }
  return out.filter((n) => /^gemini/.test(n)).sort();
}
