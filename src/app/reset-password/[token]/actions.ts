"use server";

import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import { consumeVerificationToken } from "@/lib/auth/verification-tokens";

export type ResetPasswordState = { error?: string; success?: boolean };

export async function resetPasswordAction(
  token: string,
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const result = await consumeVerificationToken(token, "PASSWORD_RESET");
  if (!result) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: result.userId }, data: { passwordHash } });

  return { success: true };
}
