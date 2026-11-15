"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** "Add a passkey on this device": the phone asks for the fingerprint, then it's saved. */
export function PasskeyAdd() {
  const router = useRouter();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setSupported("PublicKeyCredential" in window);
  }, []);

  async function add() {
    setBusy(true);
    setNote(null);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optRes = await fetch("/api/auth/passkey/register?step=options", { method: "POST" });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error ?? "Couldn't start");
      const response = await startRegistration({ optionsJSON: options });
      const res = (await fetch("/api/auth/passkey/register?step=verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(response) }).then((r) => r.json())) as { ok: boolean; name?: string; error?: string };
      if (!res.ok) throw new Error(res.error ?? "Couldn't save the passkey");
      setNote(`Added (${res.name}). Next time, tap "Sign in with fingerprint".`);
      router.refresh();
    } catch (e) {
      const err = e as Error;
      setNote(err.name === "InvalidStateError" ? "This device already has a passkey for your login." : err.name === "NotAllowedError" ? "Cancelled." : err.message);
    } finally {
      setBusy(false);
    }
  }

  if (supported === false) return <p className="text-xs text-slate-500">This browser doesn&apos;t support passkeys.</p>;
  return (
    <div className="space-y-1">
      <button type="button" onClick={add} disabled={busy || !supported} className="btn">{busy ? "Waiting for your fingerprint…" : "Add a passkey on this device"}</button>
      {note ? <p className="text-xs text-slate-600">{note}</p> : null}
    </div>
  );
}
