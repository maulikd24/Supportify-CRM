import { formatDate } from "@/lib/utils/format";
import { getProductAccess, graceEndsAt } from "@/lib/billing/access";
import { launchedProducts, PRODUCT_HOME } from "@/lib/billing/plans";
import type { ProductSubscription } from "@/generated/prisma/client";

export type SubscriptionState = {
  /** Short badge text, e.g. "Trial ended". */
  badge: string;
  tone: "default" | "secondary" | "success" | "warning" | "destructive";
  /** One line under the product name, e.g. "Trial ended 9 Oct 2026". */
  line: string;
};

type Sub = Pick<ProductSubscription, "status" | "trialEndsAt" | "currentPeriodEnd" | "pastDueSince">;

/**
 * How a product's subscription reads on the billing page. `allowed` is getProductAccess()'s
 * answer, so the wording always matches whether the product actually opens: an ended trial
 * says it ended rather than still showing "TRIALING" with a past date.
 */
export function subscriptionState(sub: Sub | null, allowed: boolean): SubscriptionState {
  if (!sub) return { badge: "Not subscribed", tone: "secondary", line: "Not subscribed" };
  switch (sub.status) {
    case "ACTIVE":
      return { badge: "Active", tone: "success", line: sub.currentPeriodEnd ? `Renews ${formatDate(sub.currentPeriodEnd)}` : "Active" };
    case "TRIALING":
      if (allowed) return { badge: "Trial", tone: "secondary", line: sub.trialEndsAt ? `Trial ends ${formatDate(sub.trialEndsAt)}` : "Trial" };
      return { badge: "Trial ended", tone: "destructive", line: sub.trialEndsAt ? `Trial ended ${formatDate(sub.trialEndsAt)}` : "Trial ended" };
    case "PAST_DUE": {
      const ends = graceEndsAt(sub);
      return allowed && ends
        ? { badge: "Payment failed", tone: "warning", line: `Payment failed. Update your card by ${formatDate(ends)}` }
        : { badge: "Payment failed", tone: "destructive", line: "Payment failed. Access is paused until it's fixed" };
    }
    case "CANCELED":
      return { badge: "Canceled", tone: "secondary", line: "Canceled" };
  }
}

/** Where "back to the app" should go: the first product the org can open, or null if none. */
export async function firstUsableProductHome(organizationId: string): Promise<string | null> {
  for (const product of launchedProducts()) {
    if ((await getProductAccess(organizationId, product)).allowed) return PRODUCT_HOME[product];
  }
  return null;
}
