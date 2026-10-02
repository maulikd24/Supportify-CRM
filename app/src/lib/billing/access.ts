import { prisma } from "@/lib/db/prisma";
import type { Product, ProductSubscription } from "@/generated/prisma/client";
import { PAST_DUE_GRACE_DAYS } from "@/lib/billing/plans";

export type ProductAccess = {
  allowed: boolean;
  subscription: ProductSubscription | null;
};

/** Read-only access check — no redirect. Use requireProductAccess() in routes; use this for UI that needs to branch without bouncing. */
export async function getProductAccess(organizationId: string, product: Product): Promise<ProductAccess> {
  const subscription = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product } },
  });

  if (!subscription) return { allowed: false, subscription: null };
  if (subscription.status === "ACTIVE") return { allowed: true, subscription };
  if (subscription.status === "TRIALING") {
    const allowed = Boolean(subscription.trialEndsAt && subscription.trialEndsAt > new Date());
    return { allowed, subscription };
  }
  if (subscription.status === "PAST_DUE") {
    // Keep access for a grace period after a failed payment while the customer fixes it.
    return { allowed: isWithinGracePeriod(subscription), subscription };
  }
  // CANCELED
  return { allowed: false, subscription };
}

export function graceEndsAt(subscription: Pick<ProductSubscription, "pastDueSince">): Date | null {
  if (!subscription.pastDueSince) return null;
  return new Date(subscription.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

export function isWithinGracePeriod(subscription: Pick<ProductSubscription, "pastDueSince">): boolean {
  const ends = graceEndsAt(subscription);
  return ends != null && ends > new Date();
}
