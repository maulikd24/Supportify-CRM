"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { isLockedOut, registerLoginFailure, resetLoginFailures } from "@/lib/auth/login-lockout";
import { clientIp, hashIdentifier, rateLimit, retryMessage } from "@/lib/security/rate-limit";
import { recordAudit } from "@/lib/audit/record";
import { ssoRequiredFor } from "@/lib/security/policy";

export type LoginState = {
  error?: string;
  stage?: "credentials" | "2fa";
  email?: string;
  password?: string;
};

export async function loginAction(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? prevState.email ?? "");
  const password = String(formData.get("password") ?? prevState.password ?? "");
  const code = formData.get("code");

  // Per-IP and per-account throttles on top of the per-account lockout.
  const [byIp, byEmail] = await Promise.all([
    rateLimit("loginByIp", await clientIp()),
    rateLimit("loginByEmail", hashIdentifier(email)),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.max(byIp.allowed ? 0 : byIp.retryAfterSeconds, byEmail.allowed ? 0 : byEmail.retryAfterSeconds);
    return { stage: "credentials", error: `Too many sign-in attempts. Try again ${retryMessage(wait)}.` };
  }

  if (typeof code === "string" && code.length > 0) {
    try {
      await signIn("credentials", { email, password, code, redirectTo: "/dashboard" });
      return {};
    } catch (error) {
      if (error instanceof AuthError) {
        // Email/password were already validated before reaching this stage, so a
        // failure here means the code itself (TOTP or recovery) was wrong.
        const user = await prisma.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
        if (user) {
          await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.login_failed", reason: "Wrong 2FA code" });
        }
        return { stage: "2fa", email, password, error: "Invalid code. Try again or use a recovery code." };
      }
      throw error;
    }
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { organization: { select: { requireSso: true } } } });
  if (!user || !user.isActive || isLockedOut(user)) {
    // Generic failure — don't reveal account existence or lockout state.
    return { stage: "credentials", error: "Invalid email or password." };
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    await registerLoginFailure(user);
    await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.login_failed", reason: "Wrong password" });
    return { stage: "credentials", error: "Invalid email or password." };
  }

  if (ssoRequiredFor(user.organization, user.orgRole)) {
    await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.login_blocked_sso_required" });
    return { stage: "credentials", error: "Your organization requires single sign-on. Use “Sign in with SSO” below." };
  }

  await resetLoginFailures(user);

  if (user.twoFactorEnabled) {
    return { stage: "2fa", email, password };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { stage: "credentials", error: "Invalid email or password." };
    }
    throw error;
  }
}
