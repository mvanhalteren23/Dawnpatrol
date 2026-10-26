// Shared types for the AI router (pure).

export const PROVIDERS = ["anthropic", "gemini"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TASKS = {
  research: { label: "Account research", web: true, help: "Web research on one business (Claude: web search + fetch; Gemini: Google Search + page reading)." },
  prospecting: { label: "Prospect search", web: true, help: "Find new businesses matching your criteria." },
  kb_draft: { label: "Knowledge base from website", web: true, help: "Read a client's website and draft receptionist knowledge." },
  extraction: { label: "Structured fields", web: false, help: "Turn a research report into fit score, contacts, prospects or KB entries." },
  outreach: { label: "Outreach emails", web: false, help: "Draft personalised first-touch emails." },
  caller_summary: { label: "Caller summaries", web: false, help: "Texts and emails sent to callers after a call." },
  test_chat: { label: "Receptionist test chat", web: false, help: "The chat on receptionist pages (the live phone agents use the model set in ElevenLabs)." },
  voicemail: { label: "AI voicemail scripts", web: false, help: "Writes the personalised voicemail the auto-dialer leaves (then voiced by ElevenLabs)." },
  call_notes: { label: "Dialer call notes", web: false, help: "Listens to dialer call recordings and writes a summary and next step. Needs Gemini (Claude can't take audio)." },
} as const;
export type Task = keyof typeof TASKS;
export const TASK_KEYS = Object.keys(TASKS) as Task[];

export type Target = { provider: Provider; model: string };
export type Route = Target & { fallback: Target | null };
export type Routes = Record<Task, Route>;

export type Usage = { model: string; tokensIn: number; tokensOut: number };
export type WebResult = Usage & { text: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };

// Claude list prices per million tokens (input, output) for the usage estimate. Gemini usage is
// billed by Google (free tier or credits) and isn't estimated here.
export const CLAUDE_PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};

export function estimateCost(provider: string, model: string, tokensIn: number, tokensOut: number): number | null {
  if (provider !== "anthropic") return null;
  const p = CLAUDE_PRICES[model];
  return p ? (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000 : null;
}
