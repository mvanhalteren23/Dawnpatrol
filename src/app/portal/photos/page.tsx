import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { formatDate } from "@/lib/utils";
import { photoToken } from "@/lib/photo-token";
import { PHOTO_RETENTION_DAYS } from "@/lib/photo-rules";
import { deletePhotos } from "@/app/customer-actions";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";

export const dynamic = "force-dynamic";

// Photos customers texted to the line, newest first. Deleted automatically after 60 days.
export default async function PortalPhotos({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const rows = receptionist ? await db.smsMedia.findMany({ where: { receptionistId: receptionist.id }, orderBy: { createdAt: "desc" }, take: 120, select: { id: true, messageSid: true, phone: true, caption: true, createdAt: true } }) : [];
  const groups = new Map<string, typeof rows>();
  for (const p of rows) groups.set(p.messageSid, [...(groups.get(p.messageSid) ?? []), p]);
  return (
    <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">Photos</h1>
      <p className="mb-6 text-sm text-slate-500">Photos your customers texted to your line (a leak, damage, the space). You&apos;re texted a link when they arrive; they&apos;re deleted after {PHOTO_RETENTION_DAYS} days.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {!receptionist ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : !groups.size ? <Empty>No photos yet. Customers can text photos to {receptionist.businessNumber ?? "your line"}.</Empty> : (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([sid, list]) => (
            <div key={sid} className="card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div><b>{list[0]!.phone}</b> · {formatDate(list[0]!.createdAt, true)}{list[0]!.caption ? <span className="text-slate-600"> · &ldquo;{list[0]!.caption}&rdquo;</span> : null}</div>
                <form action={deletePhotos.bind(null, receptionist.id, sid, `/portal/photos${q}`)}><button className="text-xs text-red-700 underline">Delete</button></form>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {list.map((p) => (
                  <a key={p.id} href={`/api/photos/${p.id}?t=${encodeURIComponent(photoToken(sid, Date.now(), 1))}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/photos/${p.id}`} alt="Photo from a customer" className="aspect-square w-full rounded-lg border border-slate-200 object-cover" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
