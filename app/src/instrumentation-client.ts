import * as Sentry from "@sentry/nextjs";

import { SENTRY_DATA_COLLECTION } from "@/lib/monitoring/sentry-options";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  dataCollection: { ...SENTRY_DATA_COLLECTION, httpBodies: [...SENTRY_DATA_COLLECTION.httpBodies] },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
