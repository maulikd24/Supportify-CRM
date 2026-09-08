"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { signIn } from "@/lib/auth/config";
import { issueVerificationToken } from "@/lib/auth/verification-tokens";
import { sendVerificationEmail } from "@/lib/email/send";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { DEFAULT_STAGE_DEFINITIONS } from "@/lib/stage-engine/stages";

export type SignupFieldErrors = Partial<Record<"orgName" | "name" | "email" | "password" | "products", string>>;
export type SignupState = { error?: string; fieldErrors?: SignupFieldErrors };

const signupSchema = z.object({
  orgName: z.string().trim().min(1, "Company name is required"),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  products: z.array(z.enum(["QA_SENTINEL", "CRM"])).min(1, "Pick at least one product to trial"),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 0;
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

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
  const slug = await uniqueSlug(orgName);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const organization = await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      members: {
        // orgRole OWNER is the tenancy/billing owner; role ADMIN is the CRM-specific
        // permission tier — the org creator needs both to manage their own team/settings.
        create: { name, email, passwordHash, orgRole: "OWNER", role: "ADMIN" },
      },
      subscriptions: {
        create: products.map((product) => ({
          product,
          status: "TRIALING" as const,
          trialEndsAt,
        })),
      },
    },
    include: { members: true },
  });

  const user = organization.members[0];

  // CRM needs a pipeline to be usable at all — seed the default one for orgs trialing it.
  if (products.includes("CRM")) {
    await prisma.stage.createMany({
      data: DEFAULT_STAGE_DEFINITIONS.map((stage) => ({ ...stage, organizationId: organization.id })),
    });
  }

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
