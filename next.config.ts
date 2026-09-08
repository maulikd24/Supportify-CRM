import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

// No Content-Security-Policy here yet — a misconfigured CSP can silently break
// Stripe Checkout redirects, Google's OAuth redirect, or Next's own inline
// styles, and needs careful allowlist testing that's out of scope for this
// pass. Everything below is safe to ship with zero risk of breaking the app.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig);
