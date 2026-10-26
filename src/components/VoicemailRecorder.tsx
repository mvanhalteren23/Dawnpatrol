"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Device } from "@twilio/voice-sdk";

/** Record a voicemail through the browser (Twilio records it; it appears in the list when saved). */
export function VoicemailRecorder() {
  const router = useRouter();
  const device = useRef<Device | null>(null);
  const [name, setName] = useState("My voicemail");
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const call = useRef<{ disconnect(): void; sendDigits(d: string): void } | null>(null);

  async function start() {
    setError(null);
    try {
      const res = (await (await fetch("/api/dialer/token", { cache: "no-store" })).json()) as { token?: string; error?: string };
      if (!res.token) throw new Error(res.error ?? "Couldn't start recording");
      const { Device } = await import("@twilio/voice-sdk");
      device.current?.destroy();
      device.current = new Device(res.token);
      const c = await device.current.connect({ params: { recordVoicemail: "1", voicemailName: name } });
      call.current = c;
      setState("recording");
      c.on("disconnect", () => {
        setState("saving");
        setTimeout(() => { setState("idle"); router.refresh(); }, 7000);
      });
      c.on("error", (e: { message?: string }) => { setError(e.message ?? "Recording failed"); setState("idle"); });
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input w-56" aria-label="Voicemail name" disabled={state !== "idle"} />
        {state === "idle" ? <button type="button" onClick={start} className="btn-secondary">🎙️ Record by phone (headset)</button> : null}
        {state === "recording" ? <button type="button" onClick={() => { call.current?.sendDigits("#"); setTimeout(() => call.current?.disconnect(), 800); }} className="btn-danger">Stop &amp; save</button> : null}
        {state === "saving" ? <span className="text-sm text-slate-500">Saving… it appears below in a few seconds.</span> : null}
      </div>
      {state === "recording" ? <p className="text-xs text-slate-500">Speak after the beep (up to 90 seconds), then click Stop &amp; save.</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
