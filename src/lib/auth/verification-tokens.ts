import { randomBytes } from "crypto";

import { prisma } from "@/lib/db/prisma";
import type { VerificationTokenPurpose } from "@/generated/prisma/client";

const EXPIRY_HOURS: Record<VerificationTokenPurpose, number> = {
  EMAIL_VERIFY: 24,
  PASSWORD_RESET: 1,
  SSO_LOGIN: 5 / 60, // 5 minutes — just enough for the WorkOS redirect round-trip
};

export async function issueVerificationToken(userId: string, purpose: VerificationTokenPurpose): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS[purpose] * 60 * 60 * 1000);

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
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }

  await prisma.verificationToken.update({ where: { token }, data: { usedAt: new Date() } });
  return { userId: record.userId };
}
