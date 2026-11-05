import { db } from "@/lib/db";
import { loadPortal } from "@/lib/portal";
import { Empty, Notice } from "@/components/ui";
import { PortalShell } from "@/components/PortalShell";
import { BookingsList } from "@/components/CustomerCare";

export const dynamic = "force-dynamic";

// Appointments the receptionist (or the booking link) booked: upcoming first, then the last two
// weeks, where a no-show can be marked (the customer gets a link to rebook).
export default async function PortalBookings({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { session, account, receptionist, adminAccountId, q } = await loadPortal(Promise.resolve(sp));
  const since = new Date(Date.now() - 14 * 86400_000);
  const bookings = receptionist ? await db.booking.findMany({ where: { receptionistId: receptionist.id, start: { gte: since } }, orderBy: { start: "asc" }, take: 100 }) : [];
  const now = Date.now();
  const upcoming = bookings.filter((b) => b.start.getTime() >= now);
  const past = bookings.filter((b) => b.start.getTime() < now).reverse();
  return (
    <PortalShell accountId={account.id} accountName={account.name} adminAccountId={adminAccountId} email={session.email}>
      <h1 className="mb-2">Bookings</h1>
      <p className="mb-6 text-sm text-slate-500">Appointments your receptionist booked. Customers get a reminder the day before; if someone doesn&apos;t show, mark it and they get a text with a link to rebook.</p>
      {sp.notice ? <Notice kind="success">{sp.notice}</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      {!receptionist ? <Empty>Your receptionist hasn&apos;t been created yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Coming up</h2><BookingsList r={receptionist} bookings={upcoming} returnTo={`/portal/bookings${q}`} timezone={receptionist.timezone} /></div>
          <div><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Last two weeks</h2><BookingsList r={receptionist} bookings={past} returnTo={`/portal/bookings${q}`} timezone={receptionist.timezone} /></div>
        </div>
      )}
    </PortalShell>
  );
}
