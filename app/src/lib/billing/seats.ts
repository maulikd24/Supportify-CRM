import { prisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/billing/stripe";

/**
 * CRM is billed per seat. A seat is an active team member (agent-portal logins
 * are QA-only and never take one); deactivated
 * users free their seat. QA Sentinel is billed per plan, not per seat.
 */
export async function countBillableSeats(organizationId: string): Promise<number> {
  return prisma.user.count({ where: { orgRole: { not: "AGENT" }, organizationId, isActive: true } });
}

/** Seats left under the CRM plan's cap, or null when the plan has no cap. */
export async function remainingSeats(organizationId: string): Promise<number | null> {
  const [subscription, used] = await Promise.all([
    prisma.productSubscription.findUnique({
      where: { organizationId_product: { organizationId, product: "CRM" } },
      select: { seats: true },
    }),
    countBillableSeats(organizationId),
  ]);
  if (subscription?.seats == null) return null;
  return Math.max(0, subscription.seats - used);
}

export async function assertSeatAvailable(organizationId: string): Promise<void> {
  const remaining = await remainingSeats(organizationId);
  if (remaining === 0) {
    throw new Error("Your CRM plan has no free seats. Upgrade in Billing, or deactivate a user to free a seat.");
  }
}

/**
 * Keeps the Stripe subscription quantity equal to the active-seat count so a
 * per-seat CRM plan bills for every seat in use (prorated). Best-effort: a
 * Stripe failure is logged and never blocks the user-management action.
 */
export async function syncCrmSeatQuantity(organizationId: string): Promise<void> {
  const subscription = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "CRM" } },
    select: { stripeSubscriptionId: true, status: true },
  });
  if (!subscription?.stripeSubscriptionId || !["ACTIVE", "PAST_DUE"].includes(subscription.status)) return;

  try {
    const quantity = Math.max(1, await countBillableSeats(organizationId));
    const stripe = getStripe();
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const item = stripeSubscription.items.data[0];
    if (!item || item.quantity === quantity) return;
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{ id: item.id, quantity }],
      proration_behavior: "create_prorations",
    });
  } catch (error) {
    console.error("Failed to sync CRM seat quantity to Stripe", { organizationId, error });
  }
}
