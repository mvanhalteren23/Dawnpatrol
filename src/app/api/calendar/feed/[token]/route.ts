import { db } from "@/lib/db";
import { icsFile } from "@/lib/email-brand";

// The owner's private calendar feed (portal → "Add bookings to my phone's calendar"): their phone's
// calendar app subscribes to it and shows every booking and blocked time. The token is the access check.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clean = token.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(clean)) return new Response("Not found", { status: 404 });
  const r = await db.receptionist.findUnique({ where: { calendarFeedToken: clean }, select: { id: true, businessName: true, name: true } });
  if (!r) return new Response("Not found", { status: 404 });
  const from = new Date(Date.now() - 30 * 86400_000);
  const to = new Date(Date.now() + 120 * 86400_000);
  const [bookings, blocks] = await Promise.all([
    db.booking.findMany({ where: { receptionistId: r.id, start: { gte: from, lte: to } }, orderBy: { start: "asc" }, take: 1000 }),
    db.calendarBlock.findMany({ where: { receptionistId: r.id, start: { gte: from, lte: to } }, take: 500 }),
  ]);
  const ics = icsFile(
    [
      ...bookings.map((b) => ({
        uid: `${b.id}@headabove`,
        start: b.start,
        end: b.end,
        title: `${b.title}: ${b.customerName}${b.status === "CANCELLED" ? " (cancelled)" : ""}`,
        description: [`Booked by ${r.name}.`, b.customerPhone ? `Phone: ${b.customerPhone}` : "", b.customerEmail ? `Email: ${b.customerEmail}` : "", `Status: ${b.status.toLowerCase().replace("_", " ")}`].filter(Boolean).join("\n"),
        status: b.status === "CANCELLED" ? ("CANCELLED" as const) : ("CONFIRMED" as const),
      })),
      ...blocks.map((b) => ({ uid: `${b.id}@headabove-block`, start: b.start, end: b.end, title: b.title })),
    ],
    { name: `${r.businessName} bookings` },
  );
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
