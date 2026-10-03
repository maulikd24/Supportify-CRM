import { randomBytes } from "node:crypto";
import { inject, vi } from "vitest";

// Must run before anything imports src/lib/db/prisma.ts, which reads this at import time.
process.env.DATABASE_URL = inject("databaseUrl");
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
process.env.STRIPE_SECRET_KEY = "sk_test_harness";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_harness";
process.env.CRON_SECRET = "cron_harness";
delete process.env.ANTHROPIC_API_KEY; // a test must never be able to spend real LLM credit

// No test may reach a real network endpoint (customer webhooks, Zendesk, Meta…).
// Tests that exercise an HTTP client stub fetch themselves with vi.stubGlobal.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`Network disabled in tests (attempted ${String(input)})`);
}) as typeof fetch;

// Next's request-scoped APIs need a live request store; outside Next they throw,
// so stub them with behavior the tests can observe.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { RedirectError } = await import("../helpers/session");
  return {
    redirect: (url: string) => {
      throw new RedirectError(url);
    },
    notFound: () => {
      throw new RedirectError("/404");
    },
  };
});

// Replaces NextAuth: `auth()` returns whatever the test set with actAs().
vi.mock("@/lib/auth/config", async () => {
  const { currentSession } = await import("../helpers/session");
  return {
    auth: async () => currentSession(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: {},
  };
});

// Any test that reaches the real Anthropic client has a bug — fail loudly.
vi.mock("@/lib/qa/assessor", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/qa/assessor")>();
  return {
    ...original,
    assessTicket: vi.fn(async () => {
      throw new Error("assessTicket must be stubbed per-test");
    }),
    analyzeDsat: vi.fn(async () => {
      throw new Error("analyzeDsat must be stubbed per-test");
    }),
  };
});
