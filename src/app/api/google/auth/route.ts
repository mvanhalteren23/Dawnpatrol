import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { authUrl } from "@/lib/google";

// ?for=me → the signed-in person's own Gmail & Calendar (any admin or rep).
// otherwise → the company connection (Drive + client receptionists' calendars, admins only).
export async function GET(req: Request) {
  const personal = new URL(req.url).searchParams.get("for") === "me";
  const session = await apiSession(personal ? "STAFF" : "ADMIN");
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state, personal ? "personal" : "company", personal ? session.email : undefined));
  res.cookies.set("g_oauth_state", `${state}.${personal ? "me" : "company"}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
