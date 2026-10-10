"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/auth/require-role";
import type { Product } from "@/generated/prisma/client";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { limitsForPlan, planById, PRODUCT_LIMIT, PRODUCTS, trialLimitsFor, type LimitKey } from "@/lib/billing/plans";

const adjustSubscriptionSchema = z.object({
  organizationId: z.string().min(1),
  product: z.enum(PRODUCTS),
  planId: z.string().optional().or(z.literal("")),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]),
  seats: z.literal("unlimited").or(z.coerce.number().int().positive()).optional().or(z.literal("")),
  reviewQuota: z.literal("unlimited").or(z.coerce.number().int().positive()).optional().or(z.literal("")),
  analysisQuota: z.literal("unlimited").or(z.coerce.number().int().positive()).optional().or(z.literal("")),
  trialEndsAt: z.string().optional().or(z.literal("")),
});

/**
 * A limit field's value: a number, "unlimited" (deliberately none), or blank. Blank used
 * to save null — which means unlimited — so clearing the field could hand a paying or
 * trial org unlimited seats or AI reviews by accident. Blank now means the plan's own
 * limit (or the trial limit); only plans with no fixed limit (contact-sales tiers) stay
 * unlimited when left blank.
 */
function resolveLimit(
  value: number | "unlimited" | "" | undefined,
  key: LimitKey,
  product: Product,
  planId: string | null,
  status: string,
): number | null {
  if (value === "unlimited") return null;
  if (typeof value === "number") return value;
  const plan = planId ? planById(product, planId) : undefined;
  if (plan?.contactSales) return null;
  const fromPlan = limitsForPlan(product, planId)[key];
  if (fromPlan !== undefined) return fromPlan;
  if (status === "TRIALING") return trialLimitsFor(product)[key] ?? null;
  throw new UserError(`Enter a ${PRODUCT_LIMIT[product].noun}, or "unlimited" — this plan has no default.`);
}

/**
 * Platform-admin-only manual override of a customer's subscription (comp,
 * support fix, plan correction) — bypasses Stripe entirely. Every use is
 * logged to the *target org's* AuditLog so a paying customer's admin can see
 * that Supportify staff touched their billing, and why.
 */
export const adjustSubscriptionAction = withUserErrors(async function adjustSubscriptionAction(formData: FormData) {
  const session = await requirePlatformAdmin();

  const parsed = adjustSubscriptionSchema.parse({
    organizationId: formData.get("organizationId"),
    product: formData.get("product"),
    planId: formData.get("planId"),
    status: formData.get("status"),
    seats: formData.get("seats") || undefined,
    reviewQuota: formData.get("reviewQuota") || undefined,
    analysisQuota: formData.get("analysisQuota") || undefined,
    trialEndsAt: formData.get("trialEndsAt") || undefined,
  });

  const product = parsed.product as Product;
  const planId = parsed.planId || null;
  // Each product has one limit column; the other stays null.
  const limitKey = PRODUCT_LIMIT[product].key;
  const data = {
    planId,
    status: parsed.status,
    seats: null as number | null,
    reviewQuota: null as number | null,
    analysisQuota: null as number | null,
    [limitKey]: resolveLimit(parsed[limitKey], limitKey, product, planId, parsed.status),
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
});
