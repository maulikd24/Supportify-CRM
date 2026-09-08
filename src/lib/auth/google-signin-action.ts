"use server";

import { signIn } from "@/lib/auth/config";

export async function signInWithGoogleAction() {
  await signIn("google", { redirectTo: "/dashboard" });
}
