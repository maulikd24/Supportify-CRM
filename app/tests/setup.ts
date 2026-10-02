import { vi } from "vitest";

// Point the app's Prisma client at the test database before anything imports it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.AUTH_SECRET ??= "test-auth-secret-test-auth-secret-0000";
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test";
// Local `prisma dev` (PGlite) mixes up parallel prepared statements; review one ticket at a time.
process.env.AUTO_REVIEW_CONCURRENCY ??= "1";

// Next request-scoped APIs aren't available outside a request.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: vi.fn(), delete: vi.fn() }),
}));

// Sessions are set per test with asUser() from tests/helpers.ts.
vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
