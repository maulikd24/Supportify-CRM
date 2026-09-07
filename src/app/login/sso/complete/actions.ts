"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";

export async function completeSsoLoginAction(token: string): Promise<{ error: string } | void> {
  try {
    await signIn("sso", { token, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "This sign-in link has expired or already been used. Please try signing in again." };
    }
    throw error;
  }
}
