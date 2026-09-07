"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getWorkos, emailDomain } from "@/lib/sso/workos";

const domainSchema = z.object({ domain: z.string().min(1, "Enter a domain") });

/** Saves (or updates) the org's SSO email domain, creating its WorkOS Organization on first save. */
export async function saveSsoDomainAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);

  const parsed = domainSchema.parse({ domain: formData.get("domain") });
  const domain = emailDomain(`user@${parsed.domain.trim().toLowerCase().replace(/^@/, "")}`);
  if (!domain) throw new Error("Enter a plain domain, e.g. acme.com");

  const existing = await prisma.organization.findUnique({ where: { ssoDomain: domain } });
  if (existing && existing.id !== session.user.organizationId) {
    throw new Error("This domain is already configured for another organization");
  }

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });

  let workosOrganizationId = organization.workosOrganizationId;
  if (!workosOrganizationId) {
    const workosOrg = await getWorkos().organizations.createOrganization({
      name: organization.name,
      externalId: organization.id,
    });
    workosOrganizationId = workosOrg.id;
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { ssoDomain: domain, workosOrganizationId },
  });

  revalidatePath("/settings/sso");
}

/** Opens WorkOS's hosted Admin Portal where the org's own IT admin configures the actual SAML/OIDC connection. */
export async function openSsoAdminPortalAction() {
  const session = await requireRole(["ADMIN"]);

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });
  if (!organization.workosOrganizationId) {
    throw new Error("Save your SSO domain first");
  }

  const { link } = await getWorkos().adminPortal.generateLink({
    intent: "sso",
    organization: organization.workosOrganizationId,
  });

  redirect(link);
}
