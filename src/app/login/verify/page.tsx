import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_COOKIE, verifyMfaPending } from "@/lib/session";
import { VerifyForm } from "./VerifyForm";

export const dynamic = "force-dynamic";

// Second step of sign-in for accounts with two-step sign-in turned on.
export default async function VerifyPage() {
  const pending = await verifyMfaPending((await cookies()).get(MFA_COOKIE)?.value);
  if (!pending) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EFE6D4] px-6">
      <div className="w-full max-w-sm space-y-6 rounded-[20px] border-2 border-[#1F3B2D] bg-white p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1F3B2D]">Two-step sign-in</h1>
          <p className="mt-2 text-sm text-slate-600">Open your authenticator app and enter the code for Head Above Digital.</p>
        </div>
        <VerifyForm />
        <Link href="/login" className="block text-center text-sm text-slate-500">Start over</Link>
      </div>
    </main>
  );
}
