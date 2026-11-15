"use client";
import { useEffect, useState } from "react";

/** "Sign in with fingerprint": shown only where the browser supports passkeys. */
export function PasskeyButton({ next }: { next: string }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const options = await fetch("/api/auth/passkey/login?step=options", { method: "POST" }).then((r) => r.json());
      const response = await startAuthentication({ optionsJSON: options });
      const res = (await fetch("/api/auth/passkey/login?step=verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response, next }) }).then((r) => r.json())) as { ok?: boolean; redirect?: string; error?: string };
      if (res.ok && res.redirect) {
        window.location.assign(res.redirect);
        return;
      }
      setError(res.error ?? "That didn't work. Sign in with your password.");
    } catch (e) {
      const name = (e as Error).name;
      // Cancelled at the fingerprint prompt: no error message needed.
      if (name !== "NotAllowedError" && name !== "AbortError") setError("This device has no passkey for Head Above yet. Sign in with your password, then add one in Settings.");
    }
    setBusy(false);
  }

  if (!supported) return null;
  return (
    <div className="space-y-2">
      <button type="button" onClick={signIn} disabled={busy} className="btn-secondary flex w-full items-center justify-center gap-2 py-2.5">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M12 11v3a8 8 0 0 1-1.5 4.7M8.5 8.6A4 4 0 0 1 16 11v1.5M16 16a14 14 0 0 1-.8 3.5M5 15.5c.6-1.3 1-2.8 1-4.5a6 6 0 0 1 9.3-5M18.8 8A6 6 0 0 1 18 14M3.5 11A8.5 8.5 0 0 1 16.4 3.7M12 14.5a17 17 0 0 1-2 6" />
        </svg>
        {busy ? "Waiting for your fingerprint…" : "Sign in with fingerprint"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
