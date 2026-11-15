"use client";
import { useEffect, useState } from "react";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return document.referrer.startsWith("android-app://") || matchMedia("(display-mode: standalone)").matches ? "Android app" : "Android phone (Chrome)";
  if (/iPhone|iPad/i.test(ua)) return "iPhone";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows computer";
  return "This browser";
}

/** Turn phone notifications on or off for this device, and send a test. */
export function PushControls() {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = (await fetch("/api/push", { cache: "no-store" }).then((r) => r.json())) as { publicKey: string };
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) }));
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), device: deviceLabel() }) });
      if (!res.ok) throw new Error("Couldn't save this device");
      setState("on");
      setNote("Notifications are on for this device. Send a test to check.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
      setNote("Notifications are off for this device.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const r = (await fetch("/api/push", { method: "PUT" }).then((x) => x.json()).catch(() => ({ ok: false }))) as { ok: boolean };
    setNote(r.ok ? "Test sent. It should appear within a few seconds." : "The test didn't go out. Turn notifications off and on again.");
    setBusy(false);
  }

  if (state === "checking") return <p className="text-xs text-slate-500">Checking this device…</p>;
  if (state === "unsupported") return <p className="text-xs text-slate-500">This browser can&apos;t show notifications. Use the Android app or Chrome.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === "on" ? (
          <>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">On for this device</span>
            <button type="button" onClick={test} disabled={busy} className="btn-secondary">Send a test</button>
            <button type="button" onClick={turnOff} disabled={busy} className="btn-secondary">Turn off here</button>
          </>
        ) : state === "blocked" ? (
          <p className="text-xs text-amber-800">Notifications are blocked for this site. On Android: long-press the Head Above app icon → App info → Notifications → allow, then reload.</p>
        ) : (
          <button type="button" onClick={turnOn} disabled={busy} className="btn">{busy ? "Turning on…" : "Turn on notifications for this device"}</button>
        )}
      </div>
      {note ? <p className="text-xs text-slate-600">{note}</p> : null}
    </div>
  );
}

/** Fills the hidden time-zone field with this device's zone. */
export function TimezoneField({ fallback }: { fallback: string }) {
  const [tz, setTz] = useState(fallback);
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || fallback);
    } catch {
      // keep fallback
    }
  }, [fallback]);
  return <input type="hidden" name="timezone" value={tz} />;
}
