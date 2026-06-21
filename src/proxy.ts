import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Lightweight route gate (Next.js 16 renamed middleware.ts → proxy.ts). This is only a
 * presence check; real session verification happens server-side in getSession/requireSession.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const p = request.nextUrl.pathname;
  if (!hasSession && (p.startsWith("/dashboard") || p.startsWith("/repo"))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/repo/:path*"] };
