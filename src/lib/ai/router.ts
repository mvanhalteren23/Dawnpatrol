import "server-only";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { safeJson } from "../utils";
import { anthropicConfigured } from "./anthropic";
import { geminiConfigured } from "./gemini";
import { PROVIDERS, TASK_KEYS, TASKS, type Provider, type Route, type Routes, type Target, type Task, type Usage } from "./types";

// Which provider and model each task runs on. Stored in the "ai.routes" setting and edited in
// CRM → Settings → AI models, so models can be swapped without a deploy. Each route has an
// optional fallback that runs when the primary call fails.

const KEY = "ai.routes";

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
  gemini: process.env.GEMINI_MODEL || "gemini-flash-latest",
};

export function providerConfigured(p: Provider): boolean {
  return p === "anthropic" ? anthropicConfigured() : geminiConfigured();
}

export function aiConfigured(): boolean {
  return PROVIDERS.some(providerConfigured);
}

/** Research-type tasks default to Gemini (Google Search) when a key is set; everything else to Claude. */
export function defaultRoutes(): Routes {
  const claude: Target = { provider: "anthropic", model: DEFAULT_MODELS.anthropic };
  const geminiT: Target = { provider: "gemini", model: DEFAULT_MODELS.gemini };
  const hasGemini = geminiConfigured();
  return Object.fromEntries(
    TASK_KEYS.map((t) => {
      const primary = TASKS[t].web && hasGemini ? geminiT : claude;
      const other = primary.provider === "gemini" ? claude : hasGemini ? geminiT : null;
      return [t, { ...primary, fallback: other }];
    }),
  ) as Routes;
}

function validTarget(x: unknown): Target | null {
  const t = x as Partial<Target> | null;
  return t && PROVIDERS.includes(t.provider as Provider) && typeof t.model === "string" && t.model.trim() ? { provider: t.provider as Provider, model: t.model.trim() } : null;
}

export async function getRoutes(): Promise<Routes> {
  const saved = safeJson<Partial<Record<Task, unknown>>>(await getSetting(KEY).catch(() => null), {});
  const defaults = defaultRoutes();
  return Object.fromEntries(
    TASK_KEYS.map((t) => {
      const r = saved[t] as (Target & { fallback?: unknown }) | undefined;
      const primary = validTarget(r);
      return [t, primary ? { ...primary, fallback: validTarget(r?.fallback) } : defaults[t]];
    }),
  ) as Routes;
}

export async function saveRoutes(routes: Routes): Promise<void> {
  await setSetting(KEY, JSON.stringify(routes));
}

async function logUsage(task: Task, provider: Provider, u: Partial<Usage> & { model: string }, error?: unknown) {
  await db.aiUsage
    .create({ data: { task, provider, model: u.model, tokensIn: u.tokensIn ?? 0, tokensOut: u.tokensOut ?? 0, ok: !error, error: error ? String((error as Error).message ?? error).slice(0, 500) : null } })
    .catch((e) => console.warn("AI usage log failed", e));
}

/**
 * Run one AI call for `task` on its routed provider/model, falling back once if the primary
 * fails (or isn't configured). Every attempt is logged in AiUsage.
 */
export async function runTask<T extends Usage>(task: Task, call: (target: Target) => Promise<T>): Promise<T & { provider: Provider }> {
  const route: Route = (await getRoutes())[task];
  const attempts = [route as Target, route.fallback].filter((t): t is Target => Boolean(t)).filter((t) => providerConfigured(t.provider));
  if (!attempts.length) throw new Error(`No AI provider is configured for ${TASKS[task].label}. Add ANTHROPIC_API_KEY or GEMINI_API_KEY.`);
  let lastError: unknown;
  for (const target of attempts) {
    try {
      const result = await call(target);
      await logUsage(task, target.provider, result);
      return { ...result, provider: target.provider };
    } catch (err) {
      lastError = err;
      console.error(`AI ${task} on ${target.provider}/${target.model} failed`, err);
      await logUsage(task, target.provider, { model: target.model }, err);
    }
  }
  throw lastError;
}
