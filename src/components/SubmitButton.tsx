"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({ children, pendingText, className = "btn", name, value, formAction }: { children: ReactNode; pendingText?: string; className?: string; name?: string; value?: string; formAction?: (form: FormData) => void | Promise<void> }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value} formAction={formAction}>
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}
