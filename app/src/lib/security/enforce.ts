import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import type { AuthMethod } from "@/lib/security/policy";

/**
 * Product layouts call this after authentication. When the organization
 * requires 2FA and this member hasn't set it up, send them to set it up first.
 * SSO sessions are exempt: the identity provider handles second factors.
 */
export async function enforceTwoFactorPolicy(user: { id: string; authMethod: AuthMethod }): Promise<void> {
  if (user.authMethod === "sso") return;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { twoFactorEnabled: true, organization: { select: { require2fa: true } } },
  });
  if (row?.organization.require2fa && !row.twoFactorEnabled) redirect("/org/account?setup2fa=1");
}
