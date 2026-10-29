import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { companyName } from "@/lib/brand";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const [{ next, error }, company] = await Promise.all([searchParams, companyName()]);
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-2">
      <div className="flex flex-col justify-between px-6 py-8 sm:px-12">
        <Link href="/" className="flex w-fit items-center gap-2.5 hover:no-underline">
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0b1530" />
            <path d="M6 21h20" stroke="#f97316" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M10 21a6 6 0 0 1 12 0" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span className="text-[17px] font-semibold tracking-tight text-[#0b1530]">{company}</span>
        </Link>
        <div className="mx-auto w-full max-w-sm py-12">
          <h1 className="text-2xl font-semibold tracking-tight text-[#0b1530]">Sign in</h1>
          <p className="mt-2 text-sm text-slate-500">Clients: see your calls, reports and receptionist settings. Team: open the CRM.</p>
          {error === "no-account" ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your login isn&apos;t linked to a business yet. Contact us and we&apos;ll fix it.</p> : null}
          <div className="mt-8"><LoginForm next={next ?? ""} /></div>
          <p className="mt-6 text-xs text-slate-500">Forgot your password? Contact us and we&apos;ll reset it.</p>
        </div>
        <Link href="/" className="text-sm text-slate-500">← Back to the website</Link>
      </div>
      <div className="relative hidden overflow-hidden bg-[#0b1530] lg:block">
        <div className="absolute inset-x-0 bottom-1/3 h-px bg-gradient-to-r from-transparent via-orange-500/70 to-transparent" />
        <div className="flex h-full flex-col justify-end p-12 text-white">
          <p className="max-w-md text-2xl font-semibold leading-snug tracking-tight">Every call answered. See what your receptionist handled this week.</p>
          <p className="mt-3 max-w-md text-sm text-slate-400">Calls, recordings, weekly and monthly reports, and your knowledge base, all in one place.</p>
        </div>
      </div>
    </main>
  );
}
