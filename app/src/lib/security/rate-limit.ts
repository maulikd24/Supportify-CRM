import { createHash } from "crypto";
import { headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";

/** [max requests, window in seconds] per protected action. */
export const RATE_LIMITS = {
  loginByIp: [30, 15 * 60],
  loginByEmail: [10, 15 * 60],
  signupByIp: [5, 60 * 60],
  passwordResetByIp: [10, 15 * 60],
  passwordResetByEmail: [3, 60 * 60],
  ssoByIp: [20, 15 * 60],
  verificationEmailByUser: [3, 60 * 60],
  apiByKey: [120, 60],
  aiDraftByUser: [20, 60],
} as const satisfies Record<string, readonly [number, number]>;

export type RateLimitName = keyof typeof RATE_LIMITS;
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Emails are hashed so the table never holds addresses in plain text. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * Fixed-window counter, incremented atomically in one statement. Fails open: if
 * the database is unavailable the request is allowed (and logged) rather than
 * locking every user out.
 */
export async function rateLimit(name: RateLimitName, identifier: string): Promise<RateLimitResult> {
  const [limit, windowSeconds] = RATE_LIMITS[name];
  const key = `${name}:${identifier}`;
  try {
    const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, NOW() + make_interval(secs => ${windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= NOW() THEN NOW() + make_interval(secs => ${windowSeconds}) ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    const row = rows[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
    return { allowed: row.count <= limit, retryAfterSeconds };
  } catch (error) {
    console.error("Rate limit check failed; allowing request", { name, error });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function retryMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;
}

/** Client IP from Vercel's forwarding headers (server actions / server components). */
export async function clientIp(): Promise<string> {
  return ipFromHeaders(await headers());
}

export function ipFromHeaders(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Deletes expired buckets; run from the daily cron. */
export async function cleanupRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date() } } });
  return count;
}
