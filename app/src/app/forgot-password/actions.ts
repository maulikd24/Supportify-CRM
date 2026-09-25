"use server";

import { prisma } from "@/lib/db/prisma";
import { issueVerificationToken } from "@/lib/auth/verification-tokens";
import { sendPasswordResetEmail } from "@/lib/email/send";

export type ForgotPasswordState = { submitted?: boolean };

export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  // Always report success, regardless of whether the account exists — don't leak which emails are registered.
  if (user) {
    const token = await issueVerificationToken(user.id, "PASSWORD_RESET");
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    try {
      await sendPasswordResetEmail({ to: email, name: user.name, resetUrl: `${appUrl}/reset-password/${token}` });
    } catch (error) {
      console.error("Failed to send password reset email", error);
    }
  }

  return { submitted: true };
}
