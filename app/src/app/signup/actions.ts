"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { signIn } from "@/lib/auth/config";
import { issueVerificationToken } from "@/lib/auth/verification-tokens";
import { sendVerificationEmail } from "@/lib/email/send";
import { provisionOrganization } from "@/lib/auth/provision-organization";

export type SignupFieldErrors = Partial<Record<"orgName" | "name" | "email" | "password" | "products", string>>;
export type SignupState = { error?: string; fieldErrors?: SignupFieldErrors };

const signupSchema = z.object({
  orgName: z.string().trim().min(1, "Company name is required"),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  products: z.array(z.enum(["QA_SENTINEL", "CRM"])).min(1, "Pick at least one product to trial"),
});

export async function signupAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    orgName: formData.get("orgName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    products: formData.getAll("products"),
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: SignupFieldErrors = {};
    for (const key of ["orgName", "name", "email", "password", "products"] as const) {
      const message = flattened[key]?.[0];
      if (message) fieldErrors[key] = message;
    }
    return { fieldErrors };
  }

  const { orgName, name, email, password, products } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { fieldErrors: { email: "An account with that email already exists." } };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await provisionOrganization({ orgName, ownerName: name, ownerEmail: email, passwordHash, products });

  const token = await issueVerificationToken(user.id, "EMAIL_VERIFY");
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    await sendVerificationEmail({ to: email, name, verifyUrl: `${appUrl}/verify-email/${token}` });
  } catch (error) {
    console.error("Failed to send verification email", error);
  }

  const redirectTo = products.includes("CRM") ? "/dashboard" : "/qa";

  try {
    await signIn("credentials", { email, password, redirectTo });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created, but sign-in failed — try logging in." };
    }
    throw error;
  }
}
