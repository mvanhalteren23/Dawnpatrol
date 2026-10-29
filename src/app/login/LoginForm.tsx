"use client";
import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button className="btn w-full bg-[#0b1530] py-2.5 hover:bg-[#16244a]" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
