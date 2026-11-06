import { NextResponse, type NextRequest } from "next/server";
import { apiSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { db } from "@/lib/db";
import { completeCalendarOAuth } from "@/lib/google";
import { recordActivity } from "@/lib/outreach";

// Back from Google's sign-in for a client's own calendar.
export async function GET(req: NextRequest) {
  const session = await apiSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/portal/settings", req.url));
  const [expected, receptionistId] = (req.cookies.get("gcal_state")?.value ?? "").split(".");
  const r = receptionistId ? await db.receptionist.findUnique({ where: { id: receptionistId }, select: { id: true, accountId: true, name: true } }) : null;
  const back = new URL(session.role === "CLIENT" || !r ? `/portal/settings${r ? `?account=${r.accountId}` : ""}` : `/crm/receptionists/${r.id}`, req.url);
  const done = (kind: "notice" | "error", message: string) => {
    back.searchParams.set(kind, message);
    const res = NextResponse.redirect(back);
    res.cookies.delete("gcal_state");
    return res;
  };
  const url = req.nextUrl;
  if (!r || !expected || url.searchParams.get("state") !== expected || !(await canAccessReceptionist(session, r.id))) return done("error", "The calendar sign-in expired. Please try again.");
  if (url.searchParams.get("error")) return done("error", url.searchParams.get("error") === "access_denied" ? "No problem: your calendar wasn't connected." : `Google said: ${url.searchParams.get("error")}`);
  const code = url.searchParams.get("code");
  if (!code) return done("error", "Google didn't finish the sign-in. Please try again.");
  try {
    const email = await completeCalendarOAuth(code, r.id, session.email);
    await recordActivity({ accountId: r.accountId, type: "NOTE", source: session.role === "CLIENT" ? "portal" : "system", subject: "Google Calendar connected", body: `${email}'s calendar is now ${r.name}'s booking calendar (connected by ${session.email}). Bookings go into it and invites come from it.` }).catch(() => undefined);
    return done("notice", `Connected: ${r.name} now books into ${email}'s Google Calendar, and checks it for busy times.`);
  } catch (err) {
    return done("error", `The calendar couldn't be connected: ${(err as Error).message}`);
  }
}
