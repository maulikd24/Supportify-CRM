import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { graceEndsAt, isWithinGracePeriod } from "@/lib/billing/access";
import { PRODUCT_LABELS } from "@/lib/billing/plans";
import { formatDate } from "@/lib/utils/format";
import type { Product } from "@/generated/prisma/client";

/** Shown while a product is PAST_DUE but still inside its grace period. */
export async function PastDueBanner({ organizationId, product }: { organizationId: string; product: Product }) {
  const subscription = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product } },
    select: { status: true, pastDueSince: true },
  });
  if (subscription?.status !== "PAST_DUE" || !isWithinGracePeriod(subscription)) return null;

  const ends = graceEndsAt(subscription)!;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-destructive/25 bg-destructive/8 px-4 py-2 text-xs font-medium md:px-6">
      <span>
        Your last {PRODUCT_LABELS[product]} payment failed. Update your payment method by {formatDate(ends)} to keep access.
      </span>
      <Link href="/billing" className="shrink-0 font-bold text-destructive hover:underline">
        Fix billing
      </Link>
    </div>
  );
}
