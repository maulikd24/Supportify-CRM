"use server";

import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import { consumeVerificationToken } from "@/lib/auth/verification-tokens";
import { clientIp, rateLimit, retryMessage } from "@/lib/security/rate-limit";
import { recordAudit } from "@/lib/audit/record";

export type ResetPasswordState = { error?: string; success?: boolean };

export async function resetPasswordAction(
  token: string,
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const limited = await rateLimit("passwordResetByIp", await clientIp());
  if (!limited.allowed) return { error: `Too many attempts. Try again ${retryMessage(limited.retryAfterSeconds)}.` };

  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const result = await consumeVerificationToken(token, "PASSWORD_RESET");
  if (!result) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // Someone who resets a forgotten password may be locking out an attacker — end every existing session.
  const user = await prisma.user.update({
    where: { id: result.userId },
    data: { passwordHash, sessionsRevokedAt: new Date() },
    select: { id: true, organizationId: true },
  });
  await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.password_reset" });

  return { success: true };
}
