import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { PRODUCT_LABELS, planById } from "@/lib/billing/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManageBillingButton } from "./manage-billing-button";
import type { Product } from "@/generated/prisma/client";

const PRODUCTS: Product[] = ["QA_SENTINEL", "CRM"];

function statusLabel(status: string, trialEndsAt: Date | null): string {
  if (status === "TRIALING") {
    return trialEndsAt ? `Trial ends ${trialEndsAt.toLocaleDateString()}` : "Trialing";
  }
  if (status === "ACTIVE") return "Active";
  if (status === "PAST_DUE") return "Payment past due";
  return "Not subscribed";
}

export default async function BillingOverviewPage() {
  const session = await requireOrg();

  const subscriptions = await prisma.productSubscription.findMany({
    where: { organizationId: session.user.organizationId },
  });
  const byProduct = new Map(subscriptions.map((s) => [s.product, s]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Billing</h1>
        <ManageBillingButton />
      </div>

      {PRODUCTS.map((product) => {
        const sub = byProduct.get(product);
        const plan = sub?.planId ? planById(product, sub.planId) : undefined;
        return (
          <Card key={product}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{PRODUCT_LABELS[product]}</CardTitle>
                <CardDescription>
                  {plan ? `${plan.name} plan` : "No plan yet"} ·{" "}
                  {statusLabel(sub?.status ?? "NONE", sub?.trialEndsAt ?? null)}
                </CardDescription>
              </div>
              <Badge variant={sub?.status === "ACTIVE" ? "default" : "secondary"}>
                {sub?.status ?? "None"}
              </Badge>
            </CardHeader>
            <CardContent>
              <Button size="sm" render={<Link href={`/billing/${product}`} />}>
                {sub ? "Change plan" : "View plans"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
