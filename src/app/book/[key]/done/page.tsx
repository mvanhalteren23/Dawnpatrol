import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "You're booked", robots: { index: false } };

export default async function BookedPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ when?: string }> }) {
  const { key } = await params;
  const { when } = await searchParams;
  const r = await db.receptionist.findUnique({ where: { bookingKey: key }, select: { businessName: true } });
  if (!r) notFound();
  return (
    <main className="min-h-screen bg-[#EFE6D4] px-4 py-16 text-[#1F3B2D]">
      <div className="mx-auto max-w-xl space-y-3 rounded-2xl bg-white p-8">
        <h1 className="text-3xl font-bold">You&apos;re booked</h1>
        <p className="text-lg">{when ? <>See you <b>{when}</b>.</> : "Your time is booked."} {r.businessName} will text you a confirmation, and a reminder the day before.</p>
        <p className="text-sm text-[#6B5A43]">Need to change it? Reply to the text, or call us.</p>
      </div>
    </main>
  );
}
