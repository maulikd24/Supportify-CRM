import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, cspEnforced } from "@/lib/security/csp";

/**
 * Adds a per-request nonce-based Content-Security-Policy to every page. Next.js reads the
 * nonce from the request's CSP header and applies it to its own scripts during rendering.
 * Report-only (violations go to /api/csp-report) until CSP_ENFORCE=true.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const enforce = cspEnforced();
  const policy = buildContentSecurityPolicy(nonce, {
    isDev: process.env.NODE_ENV === "development",
    reportUri: "/api/csp-report",
  });

  // Next extracts the nonce from the *request* CSP header, whichever mode the response uses.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, static assets and link prefetches don't need a CSP.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
