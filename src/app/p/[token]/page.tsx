import type { Metadata } from "next";
import { db } from "@/lib/db";
import { readPhotoToken } from "@/lib/photo-token";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Photos", robots: { index: false, follow: false } };

// The link the owner is texted when a customer sends photos. No sign-in: the link itself is the
// key (signed, for one text's photos, expires after 30 days).
export default async function PhotosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sid = readPhotoToken(token);
  const photos = sid ? await db.smsMedia.findMany({ where: { messageSid: sid }, orderBy: { createdAt: "asc" }, select: { id: true, phone: true, caption: true, createdAt: true, receptionist: { select: { businessName: true } } } }) : [];
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-50 p-4">
      {!photos.length ? (
        <div className="mt-16 text-center text-slate-600">This link has expired, or the photos were deleted.</div>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-semibold text-slate-900">Photos for {photos[0]!.receptionist.businessName}</h1>
          <p className="mb-4 text-sm text-slate-600">From {photos[0]!.phone} · {formatDate(photos[0]!.createdAt, true)}{photos[0]!.caption ? <> · &ldquo;{photos[0]!.caption}&rdquo;</> : null}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((p) => (
              <a key={p.id} href={`/api/photos/${p.id}?t=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/photos/${p.id}?t=${encodeURIComponent(token)}`} alt="Photo from the customer" className="w-full rounded-lg border border-slate-200 bg-white" />
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">Photos are deleted after 60 days.</p>
        </>
      )}
    </main>
  );
}
