"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { saveCallOutcome } from "@/app/crm/actions";

export type DialNumber = { contactId: string | null; label: string; phone: string }; // label e.g. "Main line" or "Jane Smith (Owner)"

export type DialTarget = {
  key: string;
  accountId: string;
  accountName: string;
  numbers: DialNumber[];
  meta?: string; // one-line summary under the name
  reasons?: string[]; // why call now
  details?: { label: string; value: string }[]; // fit score, industry, stage…
  touches?: { when: string; text: string }[]; // recent touches, newest first
  touchSummary?: string; // e.g. "4 emails (1 reply) · 2 calls · 1 note"
  research?: { opener?: string; facts: string[]; link?: string };
};

const OUTCOMES = [
  ["connected", "Connected"],
  ["booked", "Booked a meeting"],
  ["call_back", "Call back later"],
  ["voicemail", "Left voicemail"],
  ["no_answer", "No answer"],
  ["not_interested", "Not interested"],
  ["wrong_number", "Wrong number"],
] as const;
type Outcome = (typeof OUTCOMES)[number][0];

// Suggested next steps per outcome (all editable before saving).
const DEFAULT_NEXT: Record<Outcome, { call?: number; email?: boolean; demo?: boolean; prep?: boolean }> = {
  connected: { email: true, call: 7 },
  booked: { prep: true },
  call_back: { call: 1 },
  voicemail: { call: 3, email: true },
  no_answer: { call: 2 },
  not_interested: {},
  wrong_number: {},
};

type Phase = "idle" | "connecting" | "ringing" | "live" | "wrapup";

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/**
 * Browser dialer (Twilio Voice SDK). One click per call; after hanging up, pick an outcome and
 * next steps, then "Save & next" moves to the next prospect ready to dial.
 */
export function Dialer({ targets, title, emptyText }: { targets: DialTarget[]; title?: string; emptyText?: string }) {
  const device = useRef<Device | null>(null);
  const call = useRef<Call | null>(null);
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [callSid, setCallSid] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [saving, startSaving] = useTransition();
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const target = targets[active];
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({}); // account key -> index into numbers
  const numberFor = (t: DialTarget) => t.numbers[picked[t.key] ?? 0] ?? t.numbers[0];
  const current = target ? numberFor(target) : undefined;

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => device.current?.destroy(), []);

  async function getDevice(): Promise<Device> {
    if (device.current) return device.current;
    const res = await fetch("/api/dialer/token", { cache: "no-store" });
    const json = (await res.json()) as { token?: string; error?: string };
    if (!json.token) throw new Error(json.error ?? "Couldn't start the dialer");
    const { Device } = await import("@twilio/voice-sdk");
    const d = new Device(json.token, { closeProtection: "A call is in progress. Leave anyway?" });
    d.on("tokenWillExpire", async () => {
      const r = (await (await fetch("/api/dialer/token", { cache: "no-store" })).json()) as { token?: string };
      if (r.token) d.updateToken(r.token);
    });
    d.on("error", (e: { message?: string }) => setError(e.message ?? "Dialer error"));
    device.current = d;
    return d;
  }

  async function dial(index: number) {
    const t = targets[index];
    if (!t || phase === "connecting" || phase === "ringing" || phase === "live") return;
    setActive(index);
    setError(null);
    setSeconds(0);
    setMuted(false);
    setKeypad(false);
    setCallSid("");
    setOutcome("");
    setPhase("connecting");
    try {
      const d = await getDevice();
      const n = numberFor(t)!;
      const c = await d.connect({ params: { To: n.phone, accountId: t.accountId, contactId: n.contactId ?? "" } });
      call.current = c;
      c.on("ringing", () => setPhase("ringing"));
      c.on("accept", () => {
        setCallSid(c.parameters.CallSid ?? "");
        setPhase("live");
      });
      const end = () => {
        setCallSid((sid) => sid || c.parameters.CallSid || "");
        call.current = null;
        setPhase("wrapup");
      };
      c.on("disconnect", end);
      c.on("cancel", end);
      c.on("reject", end);
      c.on("error", (e: { message?: string; code?: number }) => {
        // 31005 = Twilio ended the call because the outbound leg failed; the reason is logged on the account timeline.
        setError(e.code === 31005 || e.message?.includes("31005")
          ? "Twilio couldn't connect the call. The reason (Twilio's error code) is added to this call on the account's timeline within a few seconds."
          : e.message ?? "Call failed");
        end();
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }

  function hangUp() {
    call.current?.disconnect();
  }

  function save(form: FormData, next: boolean) {
    if (!target) return;
    form.set("accountId", target.accountId);
    form.set("contactId", current?.contactId ?? "");
    form.set("callSid", callSid);
    startSaving(async () => {
      const res = await saveCallOutcome(form);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save");
        return;
      }
      setDone((s) => new Set(s).add(target.key));
      setPhase("idle");
      if (next) {
        const n = targets.findIndex((t, i) => i > active && !done.has(t.key));
        if (n >= 0) {
          setActive(n);
          rowRefs.current[targets[n]!.key]?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    });
  }

  const busy = phase === "connecting" || phase === "ringing" || phase === "live";
  const defaults = outcome ? DEFAULT_NEXT[outcome] : {};

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2>{title ?? "Dialer"}</h2>
        {busy ? <span className="text-xs text-rose-700">● {phase === "live" ? `On call ${fmt(seconds)}` : phase === "ringing" ? "Ringing…" : "Connecting…"}</span> : null}
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      {busy && target ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="font-medium">{target.accountName}</div>
          <div className="text-sm text-slate-600">{current?.label} · {current?.phone}</div>
          {target.reasons?.length ? <div className="mt-1 text-xs text-slate-600">Why: {target.reasons.join(" · ")}</div> : null}
          {target.research?.opener ? <div className="mt-1 text-xs italic text-slate-600">Opener: {target.research.opener}</div> : null}
          <p className="mt-1 text-xs text-slate-500">Calls are recorded. Mention it early: &ldquo;Just so you know, this call may be recorded.&rdquo;</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={hangUp} className="btn-danger">Hang up</button>
            <button type="button" onClick={() => { call.current?.mute(!muted); setMuted(!muted); }} className="btn-secondary">{muted ? "Unmute" : "Mute"}</button>
            <button type="button" onClick={() => setKeypad(!keypad)} className="btn-secondary">Keypad</button>
          </div>
          {keypad ? (
            <div className="mt-2 grid w-48 grid-cols-3 gap-1">
              {"123456789*0#".split("").map((k) => (
                <button key={k} type="button" onClick={() => call.current?.sendDigits(k)} className="rounded border border-slate-300 bg-white py-1 text-sm">{k}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "wrapup" && target ? (
        <form key={`${target.key}-${callSid}`} action={(f) => save(f, true)} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-medium">How did the call with {target.accountName} go?</div>
          <div className="flex flex-wrap gap-1">
            {OUTCOMES.map(([v, label]) => (
              <label key={v} className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${outcome === v ? "border-dawn-600 bg-dawn-600 text-white" : "border-slate-300 bg-white"}`}>
                <input type="radio" name="outcome" value={v} className="sr-only" checked={outcome === v} onChange={() => setOutcome(v)} required />
                {label}
              </label>
            ))}
          </div>
          <textarea name="note" rows={2} placeholder="Note (optional). The recording summary is added automatically." className="input" />
          {outcome ? (
            <fieldset key={outcome} className="space-y-1">
              <legend className="text-xs font-medium text-slate-600">Next steps (added to your task list)</legend>
              <label className="flex items-center gap-2"><input type="checkbox" name="next" value="call" defaultChecked={defaults.call != null} /> Call again in <input name="days_call" type="number" min={0} max={60} defaultValue={defaults.call ?? 2} className="input w-16 py-0.5" /> days</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="next" value="email" defaultChecked={Boolean(defaults.email)} /> Send follow-up email</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="next" value="demo" defaultChecked={Boolean(defaults.demo)} /> Send demo line + extension</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="next" value="prep" defaultChecked={Boolean(defaults.prep)} /> Prepare demo receptionist for the meeting</label>
              <div className="flex gap-2"><input name="customTask" placeholder="Other task…" className="input" /><input name="customDue" type="date" className="input w-40" /></div>
              {outcome === "not_interested" ? <label className="flex items-center gap-2"><input type="checkbox" name="markLost" defaultChecked /> Mark the account as Lost</label> : null}
            </fieldset>
          ) : null}
          <div className="flex gap-2">
            <button disabled={saving || !outcome} className="btn">{saving ? "Saving…" : "Save & next"}</button>
            <button type="button" disabled={saving || !outcome} onClick={(e) => save(new FormData(e.currentTarget.form!), false)} className="btn-secondary">Save</button>
          </div>
        </form>
      ) : null}

      {targets.length ? (
        <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {targets.map((t, i) => {
            const open = expanded === t.key;
            const n = numberFor(t);
            return (
              <li key={t.key} ref={(el) => { rowRefs.current[t.key] = el; }} className={`px-1 py-2 text-sm ${i === active ? "bg-dawn-50" : ""} ${done.has(t.key) ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setExpanded(open ? null : t.key)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                    <div className="font-medium text-slate-900"><span className="mr-1 text-xs text-slate-400">{open ? "▾" : "▸"}</span>{t.accountName}</div>
                    <div className="truncate text-xs text-slate-500">{t.reasons?.[0] ? <span className="text-amber-700">{t.reasons[0]}</span> : null}{t.reasons?.[0] && t.meta ? " · " : ""}{t.meta}</div>
                  </button>
                  {t.numbers.length > 1 ? (
                    <select value={picked[t.key] ?? 0} onChange={(e) => setPicked((p) => ({ ...p, [t.key]: Number(e.target.value) }))} className="input w-44 py-1 text-xs" aria-label="Number to dial" disabled={busy && i === active}>
                      {t.numbers.map((num, j) => <option key={j} value={j}>{num.label} · {num.phone}</option>)}
                    </select>
                  ) : <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:inline">{n?.label} · {n?.phone}</span>}
                  <button type="button" disabled={busy || phase === "wrapup" || !n} onClick={() => dial(i)} className={i === active && !done.has(t.key) ? "btn whitespace-nowrap" : "btn-secondary whitespace-nowrap"}>
                    {done.has(t.key) ? "✓ Called" : "📞 Call"}
                  </button>
                </div>
                {open ? (
                  <div className="mt-2 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-xs md:grid-cols-2">
                    <div className="space-y-2">
                      {t.reasons?.length ? (
                        <div><div className="label">Why call now</div><ul className="list-disc pl-4 text-slate-700">{t.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
                      ) : null}
                      {t.details?.length ? (
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                          {t.details.map((d) => <div key={d.label}><dt className="text-slate-500">{d.label}</dt><dd className="text-slate-800">{d.value}</dd></div>)}
                        </dl>
                      ) : null}
                      <div>
                        <div className="label">Who to call</div>
                        <ul className="space-y-0.5">
                          {t.numbers.map((num, j) => (
                            <li key={j}><label className="flex items-center gap-2"><input type="radio" name={`num-${t.key}`} checked={(picked[t.key] ?? 0) === j} onChange={() => setPicked((p) => ({ ...p, [t.key]: j }))} /> {num.label} · {num.phone}</label></li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {t.research && (t.research.opener || t.research.facts.length) ? (
                        <div>
                          <div className="label">From research</div>
                          {t.research.opener ? <p className="italic text-slate-700">&ldquo;{t.research.opener}&rdquo;</p> : null}
                          {t.research.facts.length ? <ul className="mt-1 list-disc pl-4 text-slate-700">{t.research.facts.map((f) => <li key={f}>{f}</li>)}</ul> : null}
                        </div>
                      ) : null}
                      <div>
                        <div className="label">Touches {t.touchSummary ? <span className="font-normal normal-case text-slate-500">({t.touchSummary})</span> : null}</div>
                        {t.touches?.length ? (
                          <ul className="space-y-0.5 text-slate-700">{t.touches.map((x, k) => <li key={k}><span className="text-slate-400">{x.when}</span> {x.text}</li>)}</ul>
                        ) : <p className="text-slate-500">No touches yet.</p>}
                      </div>
                      <a href={`/crm/accounts/${t.accountId}`} className="inline-block">Open account →</a>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-slate-500">{emptyText ?? "No numbers to call."}</p>}
    </div>
  );
}
