"use client";
import { useActionState } from "react";
import { createSkillKey, revokeSkillKey } from "@/app/crm/skill-actions";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { dateStyle: "medium" });

/** Settings → Claude prospecting skill: make a key, download the skill with it built in, revoke keys. */
export function SkillKeysCard({ keys }: { keys: Key[] }) {
  const [state, action, making] = useActionState(createSkillKey, undefined);
  return (
    <div id="claude-skill" className="card space-y-3 text-sm">
      <div>
        <h2>Claude prospecting skill</h2>
        <p className="mt-1 text-slate-600">
          Prospect with your own Claude plan instead of the app&apos;s API, so there are no API fees. Ask Claude something like
          <i> &ldquo;find 15 new auto repair shops in North Vancouver&rdquo;</i>. It finds them, researches each one the way the CRM&apos;s research does, and adds them here.
        </p>
      </div>
      {state?.key ? (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-semibold text-emerald-900">Your key is ready. Download the skill now: the key is built in and won&apos;t be shown again.</p>
          <form method="post" action="/api/prospects/skill">
            <input type="hidden" name="key" value={state.key} />
            <button className="btn">Download the skill (.zip)</button>
          </form>
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            <li>In Claude (claude.ai or the desktop app): <b>Settings → Capabilities</b>. Turn on code execution, then under <b>Skills</b> choose <b>Upload skill</b> and pick the .zip.</li>
            <li>So Claude can send results straight here, allow network access for code execution and add this site&apos;s domain. If you skip this, Claude gives you a file to bring in with <b>Prospecting → Import from Claude</b>.</li>
            <li>Ask Claude to find prospects. In Claude Code or Cowork, unzip the folder into your skills folder instead.</li>
          </ol>
          <p className="text-xs text-slate-600"><b>To make your Claude usage go further:</b> pick Sonnet rather than Opus for prospecting, leave Research mode and extended thinking off, and do up to 10 businesses per chat. For more, start a new chat and say &ldquo;continue prospecting…&rdquo;: businesses already added are skipped.</p>
          <p className="text-xs text-slate-500">The skill acts as you: anyone with the .zip can add accounts to the CRM. Keep it to your own Claude account, and revoke the key below if it&apos;s ever shared.</p>
        </div>
      ) : (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="label">Name for the key</span><input name="name" className="input w-56" placeholder="e.g. My Claude (laptop)" maxLength={60} /></label>
          <button className="btn" disabled={making}>{making ? "Making…" : "Make a key and download the skill"}</button>
        </form>
      )}
      {state?.error ? <p className="text-red-700">{state.error}</p> : null}
      {keys.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><b>{k.name}</b> <code className="text-xs text-slate-500">{k.prefix}…</code><span className="block text-xs text-slate-500">Made {day(k.createdAt)} · {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "not used yet"}</span></span>
              <form action={revokeSkillKey.bind(null, k.id)}><button className="text-xs text-red-700 underline">Revoke</button></form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
