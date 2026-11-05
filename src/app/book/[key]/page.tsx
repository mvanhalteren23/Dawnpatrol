import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { openings } from "@/lib/agent-booking";
import { formatSlot, localDate, isoDate } from "@/lib/booking";
import { bookFromLink } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a time", robots: { index: false } };

// The public booking page a client's customers get by text (rescue, reschedule, no-show): pick an
// open time from the business's calendar and book it.
export default async function BookPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ error?: string; r?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const r = await db.receptionist.findUnique({ where: { bookingKey: key } });
  if (!r) notFound();
  const { ready, slots } = r.bookingEnabled ? await openings(r) : { ready: false, slots: [] as Date[] };
  const byDay = new Map<string, Date[]>();
  for (const s of slots.slice(0, 120)) {
    const d = localDate(s, r.timezone);
    const k = isoDate(d.y, d.m, d.d);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const time = (s: Date) => formatSlot(s, r.timezone).split(" at ")[1];
  const dayLabel = (s: Date) => formatSlot(s, r.timezone).split(" at ")[0];
  return (
    <main className="min-h-screen bg-[#EFE6D4] px-4 py-10 text-[#1F3B2D]">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#A87A33]">{sp.r ? "Reschedule" : "Book a time"}</p>
          <h1 className="text-3xl font-bold">{r.businessName}</h1>
          <p className="mt-1 text-[#6B5A43]">{r.bookingTitle} · {r.bookingSlotMinutes} minutes · times shown in {r.timezone.replace(/^.*\//, "").replace(/_/g, " ")} time</p>
        </header>
        {sp.error ? <p role="alert" className="rounded-lg border border-[#A8401F] bg-white p-3 text-sm text-[#A8401F]">{sp.error}</p> : null}
        {!ready || !byDay.size ? (
          <p className="rounded-xl bg-white p-5">Online booking isn&apos;t available right now.{r.businessNumber ? <> Please call us at <a href={`tel:${r.businessNumber}`} className="font-semibold underline">{r.businessNumber}</a>.</> : " Please call us and we'll find a time."}</p>
        ) : (
          <form action={bookFromLink.bind(null, key)} className="space-y-6">
            <input type="hidden" name="started" value={Date.now()} />
            {sp.r ? <input type="hidden" name="r" value={sp.r} /> : null}
            <div className="hidden" aria-hidden="true"><label>Website <input name="company_website" tabIndex={-1} autoComplete="off" /></label></div>
            <fieldset className="space-y-4">
              <legend className="mb-2 text-lg font-semibold">Pick a time</legend>
              {[...byDay.entries()].slice(0, 10).map(([day, times]) => (
                <div key={day}>
                  <div className="mb-2 text-sm font-semibold">{dayLabel(times[0]!)}</div>
                  <div className="flex flex-wrap gap-2">
                    {times.map((s) => (
                      <label key={s.toISOString()} className="cursor-pointer">
                        <input type="radio" name="slot" value={s.toISOString()} required className="peer sr-only" />
                        <span className="inline-block rounded-lg border-2 border-[#1F3B2D] bg-white px-3 py-2 text-sm font-semibold peer-checked:bg-[#1F3B2D] peer-checked:text-[#EFE6D4] peer-focus-visible:ring-2 peer-focus-visible:ring-[#D8B47A]">{time(s)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            <fieldset className="grid gap-3 rounded-xl bg-white p-5 sm:grid-cols-2">
              <legend className="sr-only">Your details</legend>
              <label className="text-sm font-semibold">Name<input name="name" required maxLength={120} autoComplete="name" className="mt-1 block w-full rounded-lg border border-[#6B5A43] px-3 py-2 font-normal" /></label>
              <label className="text-sm font-semibold">Mobile number<input name="phone" required type="tel" maxLength={40} autoComplete="tel" className="mt-1 block w-full rounded-lg border border-[#6B5A43] px-3 py-2 font-normal" /></label>
              <label className="text-sm font-semibold sm:col-span-2">Email (optional, for a calendar invite)<input name="email" type="email" maxLength={200} autoComplete="email" className="mt-1 block w-full rounded-lg border border-[#6B5A43] px-3 py-2 font-normal" /></label>
              <p className="text-xs text-[#6B5A43] sm:col-span-2">We&apos;ll text you a confirmation and a reminder the day before. Reply STOP to opt out.</p>
            </fieldset>
            <button className="w-full rounded-xl bg-[#1F3B2D] px-6 py-3 text-base font-semibold text-[#EFE6D4] sm:w-auto">{sp.r ? "Move my booking" : "Book this time"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
