"use client";
import { useActionState } from "react";
import { cancelTwoStepSetup, confirmTwoStep, disableTwoStep, restartTwoStepSetup, startTwoStepSetup } from "@/app/crm/security-actions";

type Props = { enabledAt: string | null; setup: { qr: string; secret: string; url: string; account: string } | null; recoveryLeft: number };

export function TwoStepCard({ enabledAt, setup, recoveryLeft }: Props) {
  const [confirm, confirmAction, confirming] = useActionState(confirmTwoStep, undefined);
  const [off, offAction, turningOff] = useActionState(disableTwoStep, undefined);

  if (confirm?.codes) {
    return (
      <div id="two-step" className="card space-y-3">
        <h2>Two-step sign-in is on</h2>
        <p className="text-sm text-slate-600">Save these recovery codes somewhere safe, such as your password manager. Each one works once if you lose your phone. They won&apos;t be shown again.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm">{confirm.codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <p className="text-xs text-slate-500">You&apos;ve been signed out everywhere else; signing in from now on asks for a code.</p>
      </div>
    );
  }

  return (
    <div id="two-step" className="card space-y-3 text-sm">
      <h2>Two-step sign-in</h2>
      {enabledAt ? (
        <>
          <p className="text-emerald-700">On since {new Date(enabledAt).toLocaleDateString("en-CA")}. Signing in asks for a code from your authenticator app. {recoveryLeft} recovery code{recoveryLeft === 1 ? "" : "s"} left.</p>
          <form action={offAction} className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Current code to turn it off</span><input name="code" className="input w-40" inputMode="numeric" autoComplete="one-time-code" required /></label>
            <button className="btn-secondary" disabled={turningOff}>Turn off</button>
          </form>
          {off?.error ? <p className="text-red-700">{off.error}</p> : null}
        </>
      ) : setup ? (
        <>
          <p className="text-slate-600">1. Add <b>Head Above Digital</b> ({setup.account}) to Google Authenticator (or Microsoft Authenticator, 1Password):</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li><b>On this phone:</b> <a href={setup.url} className="btn-secondary mt-1 inline-flex hover:no-underline">Add to my authenticator app</a></li>
            <li><b>On a computer:</b> scan this code with the app on your phone.</li>
          </ul>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border border-slate-200" />
          <p className="text-xs text-slate-500">Or in the app choose &ldquo;Enter a setup key&rdquo;: account <b>{setup.account}</b>, key <code className="break-all font-mono">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>, type &ldquo;Time based&rdquo;.</p>
          <form action={confirmAction} className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">2. Enter the 6-digit code it shows</span><input name="code" className="input w-40" inputMode="numeric" autoComplete="one-time-code" required /></label>
            <button className="btn" disabled={confirming}>{confirming ? "Checking…" : "Turn on"}</button>
          </form>
          {confirm?.error ? <p className="text-red-700">{confirm.error}</p> : null}
          <div className="flex flex-wrap gap-4">
            <form action={restartTwoStepSetup}><button className="text-xs text-slate-500 underline">Start over with a new key</button></form>
            <form action={cancelTwoStepSetup}><button className="text-xs text-slate-500 underline">Cancel setup</button></form>
          </div>
        </>
      ) : (
        <>
          <p className="text-slate-600">Protects the CRM and your clients&apos; call data: signing in needs your password and a code from an app on your phone.</p>
          <form action={startTwoStepSetup}><button className="btn">Set up two-step sign-in</button></form>
        </>
      )}
    </div>
  );
}
