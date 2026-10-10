import { prisma } from "@/lib/db/prisma";

/** CX plans whose conversations can be analysed in real time (full-price API) instead of in batches. */
const REALTIME_PLANS = ["scale", "enterprise"];

/** Real-time analysis: Scale and Enterprise only (active or in the past-due grace period). Trials use batches. */
export async function cxRealtimeAvailable(organizationId: string): Promise<boolean> {
  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "CX_INTELLIGENCE" } },
    select: { status: true, planId: true },
  });
  if (!sub || sub.status === "TRIALING") return false;
  return (sub.status === "ACTIVE" || sub.status === "PAST_DUE") && sub.planId != null && REALTIME_PLANS.includes(sub.planId);
}
