import { prisma } from "@/lib/db/prisma";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { DEFAULT_STAGE_DEFINITIONS } from "@/lib/stage-engine/stages";
import type { Product } from "@/generated/prisma/client";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

export async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 0;
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

/**
 * Creates a new Organization with one Owner/Admin User, TRIALING
 * ProductSubscription rows for the chosen products, and (if CRM was chosen)
 * the default pipeline stages — the same shape used by both self-serve
 * email signup and JIT-provisioned OAuth signup (Google), so the two paths
 * can never drift apart.
 */
export async function provisionOrganization(params: {
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  passwordHash: string;
  products: Product[];
  emailVerifiedAt?: Date | null;
}) {
  const { orgName, ownerName, ownerEmail, passwordHash, products, emailVerifiedAt } = params;
  const slug = await uniqueOrgSlug(orgName);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const organization = await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      members: {
        // orgRole OWNER is the tenancy/billing owner; role ADMIN is the CRM-specific
        // permission tier — the org creator needs both to manage their own team/settings.
        create: {
          name: ownerName,
          email: ownerEmail,
          passwordHash,
          orgRole: "OWNER",
          role: "ADMIN",
          emailVerifiedAt: emailVerifiedAt ?? undefined,
        },
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

  // CRM needs a pipeline to be usable at all — seed the default one for orgs trialing it.
  if (products.includes("CRM")) {
    await prisma.stage.createMany({
      data: DEFAULT_STAGE_DEFINITIONS.map((stage) => ({ ...stage, organizationId: organization.id })),
    });
  }

  return organization.members[0];
}
