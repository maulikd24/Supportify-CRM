import { prisma } from "@/lib/db/prisma";
import type { User } from "@/generated/prisma/client";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Brute-force lockout shared by every place that checks a user's password —
 * `src/app/login/actions.ts` (the real entry point for a typed password) and
 * `src/lib/auth/config.ts`'s Credentials `authorize()` (the 2FA-code stage,
 * plus defense-in-depth for any direct `signIn("credentials", ...)` call).
 */
export function isLockedOut(user: Pick<User, "lockedUntil">): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil > new Date());
}

export async function registerLoginFailure(user: Pick<User, "id" | "failedLoginAttempts">): Promise<void> {
  await prisma.user.update({
    where: { id: user.id },
    data:
      user.failedLoginAttempts + 1 >= MAX_LOGIN_ATTEMPTS
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }
        : { failedLoginAttempts: { increment: 1 } },
  });
}

export async function resetLoginFailures(user: Pick<User, "id" | "failedLoginAttempts" | "lockedUntil">): Promise<void> {
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }
}
