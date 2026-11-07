import type { Metadata } from "next";
import { readUnsubscribeToken, maskEmail } from "@/lib/unsubscribe-token";
import { companyName } from "@/lib/brand";
import { suppressionFor } from "@/lib/suppression";
import { unsubscribe } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// The link at the bottom of every campaign email. One button: it doesn't unsubscribe on page
// load, because email security scanners open links automatically and would unsubscribe people
// who never clicked.
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const email = readUnsubscribeToken(token);
  const company = await companyName();
  const already = email ? await suppressionFor(email) : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="mb-2 text-xl font-semibold text-slate-900">{company}</h1>
        {!email ? (
          <p className="text-slate-600">This unsubscribe link isn&apos;t valid. Reply to the email with &quot;unsubscribe&quot; and we&apos;ll remove you.</p>
        ) : done || already ? (
          <>
            <p className="text-slate-800">You&apos;re unsubscribed.</p>
            <p className="mt-2 text-sm text-slate-500">{maskEmail(email)} won&apos;t get any more emails from us.</p>
          </>
        ) : (
          <>
            <p className="text-slate-700">Stop all emails from {company} to {maskEmail(email)}?</p>
            <form action={unsubscribe.bind(null, token)} className="mt-4">
              <button className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-700">Unsubscribe</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
