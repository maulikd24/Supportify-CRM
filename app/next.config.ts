import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs/config";

// The full, nonce-based Content-Security-Policy is set per request in src/proxy.ts
// (src/lib/security/csp.ts). The baseline CSP header below stays as an always-on
// floor — it applies even to routes the proxy skips — and browsers enforce both.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // A baseline CSP limited to directives that can't affect scripts, styles, or the
  // Stripe/Google/WorkOS redirects: no plugins/<object>, no <base> hijacking, and no
  // framing (clickjacking — same as X-Frame-Options, for browsers that prefer CSP).
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // Inlined at build time so the (client-rendered) login/signup pages can hide
  // "Continue with Google" when OAuth isn't configured for this deployment.
  env: {
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "true" : "",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Readable stack traces need source maps uploaded; only possible once the token is set.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
