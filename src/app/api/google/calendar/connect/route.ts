import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { calendarAuthUrl, calendarConnectConfigured } from "@/lib/google";
import { calendarConnectLive } from "@/lib/booking-calendar";

// "Connect Google Calendar" (portal → Your setup, or the CRM agent page): Google's sign-in for the
// calendar-only app. ?r=<receptionistId>
export async function GET(req: Request) {
  const session = await apiSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/portal/settings", req.url));
  const r = new URL(req.url).searchParams.get("r") ?? "";
  if (!(await canAccessReceptionist(session, r))) return NextResponse.redirect(new URL("/portal", req.url));
  // Clients get this once Google has approved the calendar app (CRM → Settings → Client calendars).
  if (session.role === "CLIENT" && !(await calendarConnectLive())) return NextResponse.redirect(new URL(`/portal/settings?notice=${encodeURIComponent("Your bookings use the built-in calendar for now: nothing to set up.")}`, req.url));
  if (!calendarConnectConfigured()) return NextResponse.redirect(new URL(`/portal/settings?error=${encodeURIComponent("Calendar connection isn't set up yet. Please ask the team.")}`, req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(calendarAuthUrl(state, session.role === "CLIENT" ? session.email : null));
  res.cookies.set("gcal_state", `${state}.${r}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
