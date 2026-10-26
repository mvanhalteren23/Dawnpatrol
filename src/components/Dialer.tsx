"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { saveCallOutcome } from "@/app/crm/actions";

export type DialTarget = {
  key: string;
  accountId: string;
  accountName: string;
  contactId?: string | null;
  label: string; // who/what number, e.g. "Main line" or "Jane Smith (Owner)"
  phone: string;
  meta?: string; // e.g. "Fit 78 · last touch 3d ago · North Vancouver"
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
      const c = await d.connect({ params: { To: t.phone, accountId: t.accountId, contactId: t.contactId ?? "" } });
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
      c.on("error", (e: { message?: string }) => {
        setError(e.message ?? "Call failed");
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
    form.set("contactId", target.contactId ?? "");
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
          <div className="text-sm text-slate-600">{target.label} · {target.phone}</div>
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
          {targets.map((t, i) => (
            <li key={t.key} ref={(el) => { rowRefs.current[t.key] = el; }} className={`flex items-center justify-between gap-3 px-1 py-2 text-sm ${i === active ? "bg-dawn-50" : ""} ${done.has(t.key) ? "opacity-50" : ""}`}>
              <div className="min-w-0">
                <a href={`/crm/accounts/${t.accountId}`} className="font-medium">{t.accountName}</a>
                <div className="truncate text-xs text-slate-500">{t.label} · {t.phone}{t.meta ? ` · ${t.meta}` : ""}</div>
              </div>
              <button type="button" disabled={busy || phase === "wrapup"} onClick={() => dial(i)} className={i === active && !done.has(t.key) ? "btn whitespace-nowrap" : "btn-secondary whitespace-nowrap"}>
                {done.has(t.key) ? "✓ Called" : "📞 Call"}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500">{emptyText ?? "No numbers to call."}</p>}
    </div>
  );
}
