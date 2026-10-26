"use client";
import { useState } from "react";

type Props = {
  name: string; // form field prefix: <name>_provider, <name>_model
  providers: { value: string; label: string }[];
  models: Record<string, string[]>; // provider -> model ids
  defaultProvider: string;
  defaultModel: string;
  allowNone?: boolean;
};

const CUSTOM = "__custom__";

/** Provider + model picker: the model list follows the selected provider; "Other…" allows any model id. */
export function ModelPicker({ name, providers, models, defaultProvider, defaultModel, allowNone }: Props) {
  const [provider, setProvider] = useState(defaultProvider);
  const list = models[provider] ?? [];
  const startCustom = Boolean(defaultModel) && !list.includes(defaultModel);
  const [model, setModel] = useState(startCustom ? CUSTOM : defaultModel || list[0] || "");
  const [custom, setCustom] = useState(startCustom ? defaultModel : "");

  function pickProvider(p: string) {
    setProvider(p);
    setModel(models[p]?.[0] ?? "");
    setCustom("");
  }

  const value = model === CUSTOM ? custom : model;
  return (
    <div className="space-y-1">
      <select name={`${name}_provider`} value={provider} onChange={(e) => pickProvider(e.target.value)} className="input">
        {allowNone ? <option value="">None</option> : null}
        {providers.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {provider ? (
        <>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input font-mono text-xs" aria-label="Model">
            {list.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={CUSTOM}>Other…</option>
          </select>
          {model === CUSTOM ? <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="model id" className="input font-mono text-xs" aria-label="Custom model id" /> : null}
        </>
      ) : null}
      <input type="hidden" name={`${name}_model`} value={provider ? value : ""} />
    </div>
  );
}
