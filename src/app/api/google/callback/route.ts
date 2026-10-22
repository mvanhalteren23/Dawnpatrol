import { NextResponse, type NextRequest } from "next/server";
import { apiSession } from "@/lib/auth";
import { completeOAuth } from "@/lib/google";
import { ensureRootFolders } from "@/lib/drive";

export async function GET(req: NextRequest) {
  if (!(await apiSession("ADMIN"))) return NextResponse.redirect(new URL("/login", req.url));
  const url = req.nextUrl;
  const settings = new URL("/crm/settings", req.url);
  const state = url.searchParams.get("state");
  if (!state || state !== req.cookies.get("g_oauth_state")?.value) {
    settings.searchParams.set("error", "Google sign-in expired, try again");
    return NextResponse.redirect(settings);
  }
  const code = url.searchParams.get("code");
  if (!code) {
    settings.searchParams.set("error", url.searchParams.get("error") ?? "Google did not return a code");
    return NextResponse.redirect(settings);
  }
  try {
    const email = await completeOAuth(code);
    await ensureRootFolders();
    settings.searchParams.set("notice", `Google connected${email ? ` as ${email}` : ""}. Drive folders created.`);
  } catch (err) {
    settings.searchParams.set("error", `Google connection failed: ${(err as Error).message}`);
  }
  const res = NextResponse.redirect(settings);
  res.cookies.delete("g_oauth_state");
  return res;
}
