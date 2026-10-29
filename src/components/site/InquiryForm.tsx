"use client";
import { useActionState, useState } from "react";
import { submitInquiry, type InquiryState } from "@/app/site-actions";
import { INTERESTS } from "@/lib/site";

export function InquiryForm() {
  const [state, action, pending] = useActionState<InquiryState | undefined, FormData>(submitInquiry, undefined);
  const [started] = useState(() => Date.now());

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center" role="status">
        <div className="text-lg font-semibold text-emerald-900">Thanks, we&apos;ve got it.</div>
        <p className="mt-2 text-sm text-emerald-800">We&apos;ll be in touch within one business day. To hear the receptionist in the meantime, call the demo line.</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="started" value={started} />
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Company website<input name="company_website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <Input id="inq-name" name="name" label="Your name" autoComplete="name" required />
      <Input id="inq-business" name="business" label="Business name" autoComplete="organization" required />
      <Input id="inq-email" name="email" label="Email" type="email" autoComplete="email" />
      <Input id="inq-phone" name="phone" label="Phone" type="tel" autoComplete="tel" />
      <Input id="inq-website" name="website" label="Website (optional)" placeholder="yourbusiness.ca" className="sm:col-span-2" />
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-slate-800">I&apos;m interested in</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(INTERESTS).map(([value, label], i) => (
            <label key={value} className="cursor-pointer">
              <input type="radio" name="interest" value={value} defaultChecked={i === 0} className="peer sr-only" />
              <span className="inline-block rounded-full border border-slate-300 px-4 py-1.5 text-sm text-slate-700 transition peer-checked:border-[#0b1530] peer-checked:bg-[#0b1530] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <label htmlFor="inq-message" className="mb-1 block text-sm font-medium text-slate-800">What would you like help with?</label>
        <textarea id="inq-message" name="message" rows={4} maxLength={3000} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500" placeholder="How many calls you get, when you miss them, what you'd like automated…" />
      </div>
      {state?.error ? <p className="text-sm text-red-700 sm:col-span-2" role="alert">{state.error}</p> : null}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60">{pending ? "Sending…" : "Send enquiry"}</button>
        <span className="text-xs text-slate-500">We reply within one business day. Add an email or a phone number.</span>
      </div>
    </form>
  );
}

function Input({ id, label, className = "", ...props }: { id: string; label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">{label}</label>
      <input id={id} {...props} maxLength={props.maxLength ?? 200} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500" />
    </div>
  );
}
