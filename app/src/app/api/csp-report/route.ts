import { NextResponse } from "next/server";

const MAX_BODY = 8 * 1024;

/**
 * Receives browser CSP violation reports (report-uri in src/lib/security/csp.ts) and logs a
 * compact summary, so a report-only rollout shows in the server logs what would be blocked.
 * Public by design (browsers send these unauthenticated); input is size-capped and only logged.
 */
export async function POST(request: Request) {
  const raw = (await request.text()).slice(0, MAX_BODY);
  try {
    const body = JSON.parse(raw);
    const reports = Array.isArray(body) ? body.map((r) => r?.body ?? r) : [body?.["csp-report"] ?? body];
    for (const r of reports.slice(0, 10)) {
      console.warn("CSP violation", {
        directive: r?.["effective-directive"] ?? r?.effectiveDirective ?? r?.["violated-directive"],
        blocked: r?.["blocked-uri"] ?? r?.blockedURL,
        page: r?.["document-uri"] ?? r?.documentURL,
        source: r?.["source-file"] ?? r?.sourceFile,
        line: r?.["line-number"] ?? r?.lineNumber,
      });
    }
  } catch {
    // Not JSON — ignore; reports are best-effort.
  }
  return new NextResponse(null, { status: 204 });
}
