import { db } from "@/lib/db";
import { demoLineConfig, formatPhone } from "@/lib/demo-line";

/** The live demo: the agency's own receptionist (its business line, or the demo line + extension). */
export async function liveDemo(): Promise<{ tel: string; label: string } | null> {
  // The public pages must load even if the database is briefly unreachable.
  return liveDemoFromDb().catch((err) => {
    console.warn("live demo lookup failed", err);
    return null;
  });
}

async function liveDemoFromDb(): Promise<{ tel: string; label: string } | null> {
  const [demo, own] = await Promise.all([
    demoLineConfig(),
    db.receptionist.findFirst({ where: { bookingAddsToCrm: true, demoExtension: { not: null } }, select: { demoExtension: true, businessNumber: true } }),
  ]);
  if (own?.businessNumber) return { tel: own.businessNumber, label: formatPhone(own.businessNumber) };
  if (!demo.number) return null;
  const ext = own?.demoExtension;
  return { tel: ext ? `${demo.number},,${ext}` : demo.number, label: `${formatPhone(demo.number)}${ext ? `, ext. ${ext}` : ""}` };
}

/**
 * Where "Book a demo" sends people: our own receptionist's online booking page (pick a time on our
 * calendar), or null while online booking is off (the call-back form is used instead).
 */
export async function demoBookingPath(): Promise<string | null> {
  try {
    const r = await db.receptionist.findFirst({
      where: { bookingAddsToCrm: true, bookingEnabled: true, lifecycle: "production", agentType: "inbound" },
      orderBy: { createdAt: "asc" },
      select: { id: true, bookingKey: true },
    });
    if (!r) return null;
    const { ensureBookingKey } = await import("@/lib/customer-texts");
    return `/book/${await ensureBookingKey(r)}`;
  } catch (err) {
    console.warn("demo booking link lookup failed", err);
    return null;
  }
}

export { Eyebrow } from "./Eyebrow";
