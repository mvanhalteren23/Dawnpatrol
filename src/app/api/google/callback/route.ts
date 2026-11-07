import { NextResponse, type NextRequest } from "next/server";
import { apiSession } from "@/lib/auth";
import { completeOAuth } from "@/lib/google";
import { ensureRootFolders } from "@/lib/drive";

export async function GET(req: NextRequest) {
  const [expected, kind] = (req.cookies.get("g_oauth_state")?.value ?? "").split(".");
  const personal = kind === "me";
  const inbox = kind === "inbox";
  const session = await apiSession(personal ? "STAFF" : "ADMIN");
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const url = req.nextUrl;
  const settings = new URL(inbox ? "/crm/campaigns" : "/crm/settings", req.url);
  const state = url.searchParams.get("state");
  if (!state || !expected || state !== expected) {
    settings.searchParams.set("error", "Google sign-in expired, try again");
    return NextResponse.redirect(settings);
  }
  const code = url.searchParams.get("code");
  if (!code) {
    settings.searchParams.set("error", url.searchParams.get("error") ?? "Google did not return a code");
    return NextResponse.redirect(settings);
  }
  try {
    if (inbox) {
      const email = await completeOAuth(code, { kind: "inbox" });
      settings.searchParams.set("notice", `Sending inbox connected (${email}). Choose it as a sender on a campaign.`);
    } else if (personal) {
      const email = await completeOAuth(code, { kind: "personal", userId: session.sub });
      settings.searchParams.set("notice", `Your Gmail & Calendar are connected (${email}). Emails you send from the CRM now go from this address, and replies are tracked.`);
    } else {
      const email = await completeOAuth(code, { kind: "company" });
      await ensureRootFolders();
      settings.searchParams.set("notice", `Company Google connected${email ? ` as ${email}` : ""}. Drive folders created.`);
    }
  } catch (err) {
    settings.searchParams.set("error", `Google connection failed: ${(err as Error).message}`);
  }
  const res = NextResponse.redirect(settings);
  res.cookies.delete("g_oauth_state");
  return res;
}
