import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { plansForProduct, PRODUCT_LABELS } from "@/lib/billing/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/generated/prisma/client";
import { CheckoutButton } from "./checkout-button";

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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold">
          {PRODUCT_LABELS[product]} <span className="font-serif-accent italic">plans</span>
        </h1>
        {subscription?.status === "TRIALING" && subscription.trialEndsAt && (
          <p className="text-sm text-muted-foreground">
            Your trial ends {subscription.trialEndsAt.toLocaleDateString()}.
          </p>
        )}
      </div>

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
