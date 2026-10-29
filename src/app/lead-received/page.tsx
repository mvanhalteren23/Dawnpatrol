export const metadata = { title: "Thanks, we've got your request" };

// Where the follow-up agent's website form sends visitors after they submit.
export default async function LeadReceived({ searchParams }: { searchParams: Promise<{ b?: string; later?: string }> }) {
  const { b, later } = await searchParams;
  const business = (b ?? "").slice(0, 80) || "We";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Thanks, we&apos;ve got your request</h1>
        <p className="mt-3 text-sm text-slate-600">
          {business === "We" ? "We'll" : `${business} will`} call you {later ? "as soon as we open" : "in the next few minutes"} to talk about what you need.{later ? "" : " Keep your phone handy."}
        </p>
      </div>
    </main>
  );
}
