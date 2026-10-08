/**
 * The app's Content-Security-Policy (applied per request in src/proxy.ts).
 *
 * - Scripts: only those carrying this request's nonce, plus what they load ('strict-dynamic').
 *   Next.js stamps the nonce on its own scripts automatically. This is what stops injected
 *   <script> (XSS) from running.
 * - Styles allow 'unsafe-inline': Sonner, React Flow and Base UI inject <style> tags and style
 *   attributes at runtime, which a style nonce would break; style injection is far lower risk.
 * - No form-action: Chrome applies it to the redirect after a form POST, which would block the
 *   hand-offs to Stripe Checkout, Google OAuth and WorkOS.
 * - connect-src adds only the Sentry ingest host from NEXT_PUBLIC_SENTRY_DSN, if configured.
 */
export function buildContentSecurityPolicy(nonce: string, opts: { isDev: boolean; reportUri?: string }): string {
  const sentryHost = sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.isDev ? ` 'unsafe-eval'` : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'${sentryHost ? ` ${sentryHost}` : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    ...(opts.isDev ? [] : ["upgrade-insecure-requests"]),
    ...(opts.reportUri ? [`report-uri ${opts.reportUri}`] : []),
  ];
  return directives.join("; ");
}

/** Report-only until CSP_ENFORCE=true: violations are logged (see /api/csp-report) but nothing is blocked. */
export function cspEnforced(): boolean {
  return process.env.CSP_ENFORCE === "true";
}

function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const { protocol, host } = new URL(dsn);
    return protocol === "https:" ? `https://${host}` : null;
  } catch {
    return null;
  }
}
