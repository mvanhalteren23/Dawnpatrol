import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { authUrl } from "@/lib/google";

// ?for=me → the signed-in person's own Gmail & Calendar (any admin or rep).
// ?for=inbox → a campaign sending inbox (admins only).
// otherwise → the company connection (Drive + client receptionists' calendars, admins only).
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("for");
  const personal = target === "me";
  const inbox = target === "inbox";
  const session = await apiSession(personal ? "STAFF" : "ADMIN");
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state, personal ? "personal" : inbox ? "inbox" : "company", personal ? session.email : undefined));
  res.cookies.set("g_oauth_state", `${state}.${personal ? "me" : inbox ? "inbox" : "company"}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
