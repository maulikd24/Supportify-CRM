import { notFound } from "next/navigation";
import { Sparkles, Users } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { plansForProduct, PRODUCT_LABELS, TRIAL_DAYS } from "@/lib/billing/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/generated/prisma/client";
import { CheckoutButton } from "./checkout-button";
import { StartTrialButton } from "./start-trial-button";

const PRODUCT_ICON = {
  QA_SENTINEL: Sparkles,
  CRM: Users,
} as const;

function parseProduct(value: string): Product | null {
  return value === "QA_SENTINEL" || value === "CRM" ? value : null;
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
  const Icon = PRODUCT_ICON[product];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <h1 className="font-heading text-xl font-semibold">{PRODUCT_LABELS[product]} plans</h1>
          <p className="text-sm text-muted-foreground">
            {subscription?.status === "TRIALING" && subscription.trialEndsAt
              ? `Your trial ends ${subscription.trialEndsAt.toLocaleDateString()}.`
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

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = subscription?.planId === plan.id && subscription.status === "ACTIVE";
          return (
            <Card key={plan.id} className={isCurrent ? "border-primary" : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {isCurrent && <Badge>Current</Badge>}
                </div>
                <CardDescription>{plan.priceLabel}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
                <CheckoutButton product={product} planId={plan.id} contactSales={Boolean(plan.contactSales)} disabled={isCurrent} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
