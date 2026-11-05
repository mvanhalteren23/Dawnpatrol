import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { companyName } from "@/lib/brand";
import { BrandLogo } from "@/components/site/BrandLogo";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const [{ next, error }, company] = await Promise.all([searchParams, companyName()]);
  return (
    <main className="grid min-h-screen bg-dawn-100 lg:grid-cols-2">
      <div className="flex flex-col justify-between px-6 py-8 sm:px-12">
        <Link href="/" className="w-fit hover:no-underline" aria-label={company}>
          <BrandLogo variant="light" />
        </Link>
        <div className="mx-auto w-full max-w-sm py-12">
          <h1 className="text-4xl">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600">Clients: see your calls, reports and receptionist settings. Team: open the CRM.</p>
          {error === "no-account" ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your login isn&apos;t linked to a business yet. Contact us and we&apos;ll fix it.</p> : null}
          <div className="mt-8"><LoginForm next={next ?? ""} /></div>
          <p className="mt-6 text-xs text-slate-500">Forgot your password? Contact us and we&apos;ll reset it.</p>
        </div>
        <Link href="/" className="text-sm text-slate-500">← Back to the website</Link>
      </div>
      <div className="relative hidden overflow-hidden border-l-4 border-dawn-700 bg-dawn-600 lg:block">
        <div className="absolute inset-x-0 bottom-1/3 h-px bg-gradient-to-r from-transparent via-dawn-400/70 to-transparent" />
        <div className="flex h-full flex-col justify-end p-12 text-dawn-100">
          <p className="max-w-md font-condensed text-4xl font-extrabold leading-tight">Every call answered, even when you&apos;re on the tools.</p>
          <p className="mt-3 max-w-md text-sm text-dawn-100/80">Calls, recordings, weekly and monthly reports, and your knowledge base, all in one place.</p>
        </div>
      </div>
    </main>
  );
}
