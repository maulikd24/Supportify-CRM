import { notFound } from "next/navigation";
import { Radar, Sparkles, Users } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { annualBillingAvailable, launchedProducts, plansForProduct, PRODUCT_LABELS, TRIAL_DAYS } from "@/lib/billing/plans";
import { getProductAccess } from "@/lib/billing/access";
import { subscriptionState } from "@/lib/billing/status";
import { Card, CardContent } from "@/components/ui/card";
import type { Product } from "@/generated/prisma/client";
import { PlanPicker } from "./plan-picker";
import { StartTrialButton } from "./start-trial-button";

const PRODUCT_ICON = {
  QA_SENTINEL: Sparkles,
  CRM: Users,
  CX_INTELLIGENCE: Radar,
} as const satisfies Record<Product, unknown>;

function parseProduct(value: string): Product | null {
  return (launchedProducts() as string[]).includes(value) ? (value as Product) : null;
}

export default async function ProductBillingPage({ params }: { params: Promise<{ product: string }> }) {
  const session = await requireOrg();
  const { product: productParam } = await params;
  const product = parseProduct(productParam);
  if (!product) notFound();

  const subscription = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId: session.user.organizationId, product } },
  });

  const plans = plansForProduct(product);
  const allowed = (await getProductAccess(session.user.organizationId, product)).allowed;
  const trialEnded = subscription?.status === "TRIALING" && !allowed;
  const Icon = PRODUCT_ICON[product];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <h2 className="font-heading text-[19px] font-extrabold">{PRODUCT_LABELS[product]} plans</h2>
          <p className={trialEnded ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
            {trialEnded
              ? `${subscriptionState(subscription, false).line}. Pick a plan to keep using ${PRODUCT_LABELS[product]}; your data is kept.`
              : subscription?.status === "TRIALING" && subscription.trialEndsAt
                ? `${subscriptionState(subscription, true).line}.`
                : "Pick the plan that fits your team — switch or cancel any time."}
          </p>
        </div>
      </div>

      {!subscription && ["OWNER", "ADMIN"].includes(session.user.orgRole) && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-heading font-semibold">Try {PRODUCT_LABELS[product]} free for {TRIAL_DAYS} days</p>
              <p className="text-sm text-muted-foreground">No card required. Pick a plan any time before the trial ends.</p>
            </div>
            <StartTrialButton product={product} />
          </CardContent>
        </Card>
      )}

      <PlanPicker
        product={product}
        plans={plans}
        currentPlanId={subscription?.status === "ACTIVE" || subscription?.status === "PAST_DUE" ? (subscription.planId ?? null) : null}
        currentInterval={subscription?.billingInterval === "year" ? "year" : subscription?.billingInterval === "month" ? "month" : null}
        annualAvailable={annualBillingAvailable(product)}
      />
    </div>
  );
}
