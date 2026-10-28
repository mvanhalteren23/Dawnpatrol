import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Coarse gate; pages and routes re-check roles server-side.
export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;
  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/crm") && session.role !== "ADMIN" && session.role !== "REP") {
    return NextResponse.redirect(new URL("/portal", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/crm/:path*", "/portal/:path*"] };
