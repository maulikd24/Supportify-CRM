"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/auth/require-role";
import type { Product } from "@/generated/prisma/client";

const adjustSubscriptionSchema = z.object({
  organizationId: z.string().min(1),
  product: z.enum(["QA_SENTINEL", "CRM"]),
  planId: z.string().optional().or(z.literal("")),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]),
  seats: z.coerce.number().int().positive().optional().or(z.literal("")),
  reviewQuota: z.coerce.number().int().positive().optional().or(z.literal("")),
  trialEndsAt: z.string().optional().or(z.literal("")),
});

/**
 * Platform-admin-only manual override of a customer's subscription (comp,
 * support fix, plan correction) — bypasses Stripe entirely. Every use is
 * logged to the *target org's* AuditLog so a paying customer's admin can see
 * that Supportify staff touched their billing, and why.
 */
export async function adjustSubscriptionAction(formData: FormData) {
  const session = await requirePlatformAdmin();

  const parsed = adjustSubscriptionSchema.parse({
    organizationId: formData.get("organizationId"),
    product: formData.get("product"),
    planId: formData.get("planId"),
    status: formData.get("status"),
    seats: formData.get("seats") || undefined,
    reviewQuota: formData.get("reviewQuota") || undefined,
    trialEndsAt: formData.get("trialEndsAt") || undefined,
  });

  const product = parsed.product as Product;
  const data = {
    planId: parsed.planId || null,
    status: parsed.status,
    seats: parsed.seats === "" || parsed.seats === undefined ? null : parsed.seats,
    reviewQuota: parsed.reviewQuota === "" || parsed.reviewQuota === undefined ? null : parsed.reviewQuota,
    trialEndsAt: parsed.trialEndsAt ? new Date(parsed.trialEndsAt) : null,
  };

  const before = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId: parsed.organizationId, product } },
  });

  const after = await prisma.productSubscription.upsert({
    where: { organizationId_product: { organizationId: parsed.organizationId, product } },
    create: { organizationId: parsed.organizationId, product, ...data },
    update: data,
  });

  await prisma.auditLog.create({
    data: {
      organizationId: parsed.organizationId,
      userId: session.user.id,
      entity: "ProductSubscription",
      entityId: after.id,
      action: "platform_admin_adjusted_subscription",
      oldValue: before ? JSON.parse(JSON.stringify(before)) : undefined,
      newValue: JSON.parse(JSON.stringify(after)),
      reason: `Adjusted by Supportify staff (${session.user.email})`,
    },
  });

  revalidatePath(`/admin/organizations/${parsed.organizationId}`);
}
