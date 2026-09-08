"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { isLockedOut, registerLoginFailure, resetLoginFailures } from "@/lib/auth/login-lockout";

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

  if (typeof code === "string" && code.length > 0) {
    try {
      await signIn("credentials", { email, password, code, redirectTo: "/dashboard" });
      return {};
    } catch (error) {
      if (error instanceof AuthError) {
        // Email/password were already validated before reaching this stage, so a
        // failure here means the code itself (TOTP or recovery) was wrong.
        return { stage: "2fa", email, password, error: "Invalid code. Try again or use a recovery code." };
      }
      throw error;
    }
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || isLockedOut(user)) {
    // Generic failure — don't reveal account existence or lockout state.
    return { stage: "credentials", error: "Invalid email or password." };
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    await registerLoginFailure(user);
    return { stage: "credentials", error: "Invalid email or password." };
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
