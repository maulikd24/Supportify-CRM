import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { proxy } from "@/proxy";
import { POST as cspReport } from "@/app/api/csp-report/route";

const directive = (policy: string, name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("content security policy", () => {
  it("only lets scripts with this request's nonce run — no 'unsafe-inline' or eval in production", () => {
    const policy = buildContentSecurityPolicy("abc123", { isDev: false });
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    // Deliberately absent: form-action would block redirects to Stripe/Google/WorkOS.
    expect(policy).not.toContain("form-action");
  });

  it("allows eval only in development (React dev tooling), and doesn't upgrade http://localhost", () => {
    const policy = buildContentSecurityPolicy("n", { isDev: true });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("lets the browser reach only the configured Sentry ingest host", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o123.ingest.us.sentry.io/456");
    expect(directive(buildContentSecurityPolicy("n", { isDev: false }), "connect-src")).toBe("connect-src 'self' https://o123.ingest.us.sentry.io");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(directive(buildContentSecurityPolicy("n", { isDev: false }), "connect-src")).toBe("connect-src 'self'");
  });

  it("proxy: a fresh nonce per request, report-only by default, enforced with CSP_ENFORCE=true", () => {
    const a = proxy(new NextRequest("https://app.test/dashboard"));
    const b = proxy(new NextRequest("https://app.test/dashboard"));
    const policyA = a.headers.get("content-security-policy-report-only")!;
    expect(policyA).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(a.headers.get("content-security-policy")).toBeNull();
    expect(policyA).not.toBe(b.headers.get("content-security-policy-report-only"));
    expect(policyA).toContain("report-uri /api/csp-report");

    vi.stubEnv("CSP_ENFORCE", "true");
    const enforced = proxy(new NextRequest("https://app.test/dashboard"));
    expect(enforced.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-/);
    expect(enforced.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("report endpoint logs a compact summary and always answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await cspReport(
      new Request("https://app.test/api/csp-report", {
        method: "POST",
        body: JSON.stringify({ "csp-report": { "document-uri": "https://app.test/x", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.test/a.js" } }),
      }),
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("CSP violation", expect.objectContaining({ directive: "script-src-elem", blocked: "https://evil.test/a.js" }));
    expect((await cspReport(new Request("https://app.test/api/csp-report", { method: "POST", body: "not json" }))).status).toBe(204);
  });
});
