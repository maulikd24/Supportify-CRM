import { randomUUID } from "node:crypto";
import { vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/config";
import type { OrgRole, Product, Role, SubscriptionStatus } from "@/generated/prisma/client";

export { prisma };

const uid = () => randomUUID().slice(0, 8);

export async function createOrg(opts: {
  products?: { product: Product; status?: SubscriptionStatus; planId?: string | null; reviewQuota?: number | null; seats?: number | null; trialEndsAt?: Date | null; stripeSubscriptionId?: string | null; billingInterval?: string | null }[];
} = {}) {
  const id = `org_${uid()}`;
  const org = await prisma.organization.create({ data: { id, name: `Org ${id}`, slug: id, stripeCustomerId: `cus_${id}` } });
  for (const p of opts.products ?? []) {
    await prisma.productSubscription.create({
      data: {
        organizationId: id,
        product: p.product,
        status: p.status ?? "ACTIVE",
        planId: p.planId ?? null,
        reviewQuota: p.reviewQuota ?? null,
        seats: p.seats ?? null,
        trialEndsAt: p.trialEndsAt ?? null,
        stripeSubscriptionId: p.stripeSubscriptionId ?? null,
        billingInterval: p.billingInterval ?? null,
      },
    });
  }
  const stage = await prisma.stage.create({ data: { organizationId: id, name: "New", sequence: 1, slaHours: 24 } });
  return { org, stage };
}

export async function createUser(organizationId: string, opts: { role?: Role; orgRole?: OrgRole; isActive?: boolean } = {}) {
  const id = `u_${uid()}`;
  return prisma.user.create({
    data: {
      id,
      organizationId,
      name: `User ${id}`,
      email: `${id}@test.local`,
      passwordHash: "x",
      role: opts.role ?? "ADMIN",
      orgRole: opts.orgRole ?? "OWNER",
      isActive: opts.isActive ?? true,
      emailVerifiedAt: new Date(),
    },
  });
}

export async function createClient(organizationId: string, stageId: string, name = "Client") {
  return prisma.client.create({
    data: { organizationId, clientCode: `CL-${uid()}`, name, mobile: "9999999999", currentStageId: stageId },
  });
}

/** Makes the mocked auth() return a session for this user (as every server action / route sees it). */
export function asUser(user: { id: string; name: string; email: string; role: Role; organizationId: string; orgRole: OrgRole }) {
  vi.mocked(auth).mockResolvedValue({
    user: { ...user, isPlatformAdmin: false, authMethod: "password" },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as never);
}

export function signedOut() {
  vi.mocked(auth).mockResolvedValue(null as never);
}

export async function deleteOrgs(...ids: string[]) {
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

/** Asserts a server action / guard redirected (requireRole/requireOrg throw NEXT_REDIRECT). */
export function isRedirect(error: unknown, to?: string): boolean {
  const digest = (error as { digest?: string })?.digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") && (!to || digest.includes(to));
}
