import { randomBytes } from "crypto";

import { prisma } from "@/lib/db/prisma";
import type { VerificationTokenPurpose } from "@/generated/prisma/client";

const EXPIRY_HOURS: Record<VerificationTokenPurpose, number> = {
  EMAIL_VERIFY: 24,
  PASSWORD_RESET: 1,
  SSO_LOGIN: 5 / 60, // 5 minutes — just enough for the WorkOS redirect round-trip
};

export async function issueVerificationToken(
  userId: string,
  purpose: VerificationTokenPurpose,
  /** Overrides the purpose's default lifetime (e.g. a longer-lived invite link). */
  expiresInHours: number = EXPIRY_HOURS[purpose],
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await prisma.verificationToken.create({
    data: { token, userId, purpose, expiresAt },
  });

  return token;
}

/** Validates and consumes a token in one step; returns the associated userId, or null if invalid/expired/used. */
export async function consumeVerificationToken(
  token: string,
  purpose: VerificationTokenPurpose,
): Promise<{ userId: string } | null> {
  // Claim the token in one conditional UPDATE. A read-then-mark would let two
  // concurrent requests both see it unused and both succeed (e.g. one password
  // reset link used twice); Postgres re-checks the WHERE under the row lock, so
  // exactly one claim wins.
  const now = new Date();
  const { count } = await prisma.verificationToken.updateMany({
    where: { token, purpose, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) return null;

  const record = await prisma.verificationToken.findUniqueOrThrow({ where: { token }, select: { userId: true } });
  return { userId: record.userId };
}
