import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware (defense in depth only):
 * - Fast-redirects obviously-unauthenticated requests for protected paths.
 * - Real authorization stays server-side in layouts/pages/services (ADR-003);
 *   middleware cannot query the DB, so it checks cookie presence only.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/settings"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isProtected) return NextResponse.next();

  const hasSessionCookie =
    request.cookies.has("swasthya_session") || request.cookies.has("__Secure-swasthya_session");

  if (!hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/settings/:path*"],
};
