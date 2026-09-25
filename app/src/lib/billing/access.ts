import { prisma } from "@/lib/db/prisma";
import type { Product, ProductSubscription } from "@/generated/prisma/client";

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
  // PAST_DUE, CANCELED
  return { allowed: false, subscription };
}
