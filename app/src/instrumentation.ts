import * as Sentry from "@sentry/nextjs";

import { SENTRY_DATA_COLLECTION } from "@/lib/monitoring/sentry-options";

/**
 * Error monitoring. Sentry stays inert until SENTRY_DSN (server) and
 * NEXT_PUBLIC_SENTRY_DSN (browser) are set, so this is safe without an account.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      enabled: Boolean(process.env.SENTRY_DSN),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      // Customer data (tickets, contacts) must not leave via error reports.
      dataCollection: { ...SENTRY_DATA_COLLECTION, httpBodies: [...SENTRY_DATA_COLLECTION.httpBodies] },
    });
  }
}

// Server Components, route handlers and server actions: reported with the same
// digest customers see on the in-app error card.
export const onRequestError = Sentry.captureRequestError;
