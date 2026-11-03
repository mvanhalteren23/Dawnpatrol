"use client";
import { useActionState } from "react";
import { verifyCodeAction } from "../actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyCodeAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">6-digit code from your authenticator app</span>
        <input className="input text-center text-lg tracking-[0.3em]" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} required autoFocus />
      </label>
      <p className="text-xs text-slate-500">Lost your phone? Enter one of your recovery codes (like abcde-fghij) instead.</p>
      {state?.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button className="btn w-full bg-[#1F3B2D] py-2.5 hover:bg-[#173022]" disabled={pending}>{pending ? "Checking…" : "Verify and sign in"}</button>
    </form>
  );
}
