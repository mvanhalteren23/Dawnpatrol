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

export function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div style={{ letterSpacing: "0.2em" }} className={`font-condensed-700 mb-2 text-sm uppercase ${dark ? "text-[#D8B47A]" : "text-[#A87A33]"}`}>{children}</div>;
}
