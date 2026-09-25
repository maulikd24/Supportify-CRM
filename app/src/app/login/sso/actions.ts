"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { getWorkos, workosClientId, ssoCallbackUrl, emailDomain } from "@/lib/sso/workos";

export type SsoLoginState = { error?: string };

const emailSchema = z.string().email();

export async function startSsoLoginAction(_prevState: SsoLoginState, formData: FormData): Promise<SsoLoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid work email address" };

  const domain = emailDomain(parsed.data);
  if (!domain) return { error: "Enter a valid work email address" };

  const organization = await prisma.organization.findUnique({ where: { ssoDomain: domain } });
  if (!organization?.workosOrganizationId) {
    return { error: "SSO is not set up for your organization. Use your email and password instead." };
  }

  const url = getWorkos().sso.getAuthorizationUrl({
    organization: organization.workosOrganizationId,
    clientId: workosClientId(),
    redirectUri: ssoCallbackUrl(),
  });

  redirect(url);
}
