import { LoginForm } from "./LoginForm";
import { companyName } from "@/lib/brand";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, company] = await Promise.all([searchParams, companyName()]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-dawn-900 via-indigo-900 to-dawn-600 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="text-3xl">🌅</div>
          <h1 className="mt-2">{company}</h1>
          <p className="text-sm text-slate-500">Never miss a call. Never lose a client.</p>
        </div>
        <LoginForm next={next ?? ""} />
      </div>
    </main>
  );
}
