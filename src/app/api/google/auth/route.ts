import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { authUrl } from "@/lib/google";

export async function GET(req: Request) {
  if (!(await apiSession("ADMIN"))) return NextResponse.redirect(new URL("/login", req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
