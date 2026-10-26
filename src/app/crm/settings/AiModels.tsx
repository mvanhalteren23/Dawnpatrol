import { db } from "@/lib/db";
import { DEFAULT_MODELS, getRoutes, providerConfigured } from "@/lib/ai/router";
import { listGeminiModels } from "@/lib/ai/gemini";
import { CLAUDE_PRICES, PROVIDERS, TASK_KEYS, TASKS, estimateCost } from "@/lib/ai/types";
import { formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { ModelPicker } from "@/components/ModelPicker";
import { getSetting } from "@/lib/settings";
import { AUTO_RESEARCH_BATCH_LIMIT, AUTO_RESEARCH_KEY } from "@/lib/jobs";
import { resetAiRoutes, saveAiRoutes, saveAutoResearch } from "../actions";

const PROVIDER_LABEL = { anthropic: "Claude (Anthropic API)", gemini: "Gemini (Google AI Studio)" } as const;

async function geminiModels(): Promise<string[]> {
  // The settings page shouldn't hang on Google; fall back to a typed-in model name.
  const timeout = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 4000));
  return Promise.race([listGeminiModels().catch(() => []), timeout]);
}

export async function AiModels() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [routes, gModels, usage, autoResearch] = await Promise.all([
    getRoutes(),
    geminiModels(),
    db.aiUsage.groupBy({ by: ["task", "provider", "model", "ok"], where: { createdAt: { gte: since } }, _count: true, _sum: { tokensIn: true, tokensOut: true } }),
    getSetting(AUTO_RESEARCH_KEY),
  ]);
  const claudeModels = Object.keys(CLAUDE_PRICES);
  const providerOptions = PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }));
  // Gemini: the models this key can call (newest aliases first), else the known aliases.
  const geminiList = gModels.length ? [...gModels.filter((m) => m.endsWith("-latest")), ...gModels.filter((m) => !m.endsWith("-latest"))] : [DEFAULT_MODELS.gemini, "gemini-pro-latest"];
  const modelLists: Record<string, string[]> = { anthropic: claudeModels, gemini: geminiList };
  const totalCost = usage.reduce((n, u) => n + (estimateCost(u.provider, u.model, u._sum.tokensIn ?? 0, u._sum.tokensOut ?? 0) ?? 0), 0);

  return (
    <div className="card space-y-4">
      <div>
        <h2>AI models</h2>
        <p className="text-xs text-slate-500">
          Pick the provider and model for each job. Changes apply on the next run, no deploy needed. If the first choice fails, the fallback runs.
          The phone agents (Mike, Ava) use the model set in ElevenLabs, not these.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {PROVIDERS.map((p) => (
            <Badge key={p} className={providerConfigured(p) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}>
              {PROVIDER_LABEL[p]}: {providerConfigured(p) ? "connected" : p === "gemini" ? "add GEMINI_API_KEY" : "add ANTHROPIC_API_KEY"}
            </Badge>
          ))}
        </div>
      </div>


      <form action={saveAutoResearch} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="autoResearch" defaultChecked={autoResearch !== "off"} /> Research every new account automatically</label>
        <span className="text-xs text-slate-500">Booked calls, manual adds, webhooks, prospect lists and CSV imports (first {AUTO_RESEARCH_BATCH_LIMIT} per batch). Uses the &ldquo;Company profile (facts only)&rdquo; prompt on the Account research model; only fills empty fields, and drops any phone, email or website the research report doesn&apos;t actually contain.</span>
        <SubmitButton className="btn-secondary" pendingText="Saving…">Save</SubmitButton>
      </form>

      <form action={saveAiRoutes} className="space-y-3">
        {TASK_KEYS.map((t) => {
          const r = routes[t];
          return (
            <div key={t} className="grid grid-cols-1 gap-2 border-b border-slate-100 pb-3 text-sm md:grid-cols-[11rem_1fr_1fr]">
              <div>
                <div className="font-medium">{TASKS[t].label}</div>
                <div className="text-xs text-slate-500">{TASKS[t].help}</div>
              </div>
              <div>
                <div className="label">Use</div>
                <ModelPicker name={t} providers={providerOptions} models={modelLists} defaultProvider={r.provider} defaultModel={r.model} />
              </div>
              <div>
                <div className="label">Fallback</div>
                <ModelPicker name={`${t}_fb`} providers={providerOptions} models={modelLists} defaultProvider={r.fallback?.provider ?? ""} defaultModel={r.fallback?.model ?? ""} allowNone />
              </div>
            </div>
          );
        })}
        <div className="flex gap-2">
          <SubmitButton pendingText="Saving…">Save AI models</SubmitButton>
          <SubmitButton formAction={resetAiRoutes} className="btn-secondary" pendingText="Resetting…">Reset to defaults</SubmitButton>
        </div>
        <p className="text-xs text-slate-500">The model list follows the provider. {gModels.length ? "Gemini shows every model your key can use; " : ""}<code>-latest</code> models always point to Google&apos;s newest version. Pick &ldquo;Other…&rdquo; to type any model id.</p>
      </form>

      <div>
        <h3 className="mb-2 font-medium">Usage, last 30 days</h3>
        {usage.length ? (
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr><th>Job</th><th>Model</th><th className="text-right">Calls</th><th className="text-right">Tokens in / out</th><th className="text-right">Est. cost</th></tr>
            </thead>
            <tbody>
              {usage.sort((a, b) => (b._sum.tokensIn ?? 0) - (a._sum.tokensIn ?? 0)).map((u) => {
                const cost = estimateCost(u.provider, u.model, u._sum.tokensIn ?? 0, u._sum.tokensOut ?? 0);
                return (
                  <tr key={`${u.task}-${u.provider}-${u.model}-${u.ok}`} className="border-t border-slate-100">
                    <td className="py-1">{TASKS[u.task as keyof typeof TASKS]?.label ?? u.task}{u.ok ? "" : <Badge className="ml-1 bg-red-100 text-red-800">failed</Badge>}</td>
                    <td className="font-mono">{u.model}</td>
                    <td className="text-right">{u._count}</td>
                    <td className="text-right">{(u._sum.tokensIn ?? 0).toLocaleString()} / {(u._sum.tokensOut ?? 0).toLocaleString()}</td>
                    <td className="text-right">{cost == null ? (u.provider === "gemini" ? "Google" : "—") : formatMoney(Math.round(cost * 100))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="text-xs text-slate-500">No AI calls logged yet.</p>}
        <p className="mt-1 text-xs text-slate-500">Claude estimate at list prices (USD): {formatMoney(Math.round(totalCost * 100))}. Claude web searches are billed per search on top of tokens. Gemini usage is billed by Google: free tier, credits or your Google bill.</p>
      </div>
    </div>
  );
}
