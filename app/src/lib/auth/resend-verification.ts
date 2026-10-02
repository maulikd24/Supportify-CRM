"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { issueVerificationToken } from "@/lib/auth/verification-tokens";
import { sendVerificationEmail } from "@/lib/email/send";
import { rateLimit } from "@/lib/security/rate-limit";

export async function resendVerificationEmailAction() {
  const session = await requireUser();

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (user.emailVerifiedAt) return;
  if (!(await rateLimit("verificationEmailByUser", user.id)).allowed) return;

  const token = await issueVerificationToken(user.id, "EMAIL_VERIFY");
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  await sendVerificationEmail({ to: user.email, name: user.name, verifyUrl: `${appUrl}/verify-email/${token}` });
}
