import Link from "next/link";
import { CreditCard, Sparkles, Users } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { PRODUCT_LABELS, planById } from "@/lib/billing/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManageBillingButton } from "./manage-billing-button";
import type { Product } from "@/generated/prisma/client";

const PRODUCTS: Product[] = ["QA_SENTINEL", "CRM"];

const PRODUCT_ICON = {
  QA_SENTINEL: Sparkles,
  CRM: Users,
} as const;

function statusLabel(status: string, trialEndsAt: Date | null): string {
  if (status === "TRIALING") {
    return trialEndsAt ? `Trial ends ${trialEndsAt.toLocaleDateString()}` : "Trialing";
  }
  if (status === "ACTIVE") return "Active";
  if (status === "PAST_DUE") return "Payment past due";
  return "Not subscribed";
}

function UsageMeter({ label, used, total }: { label: string; used: number; total: number | null }) {
  if (total == null) {
    return (
      <p className="text-sm text-muted-foreground">
        {label}: <span className="font-medium text-foreground">{used}</span> (unlimited)
      </p>
    );
  }
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {used} / {total}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function BillingOverviewPage() {
  const session = await requireOrg();

  const [subscriptions, seatsUsed] = await Promise.all([
    prisma.productSubscription.findMany({
      where: { organizationId: session.user.organizationId },
    }),
    prisma.user.count({ where: { organizationId: session.user.organizationId, isActive: true } }),
  ]);
  const byProduct = new Map(subscriptions.map((s) => [s.product, s]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your plan and usage for each product.</p>
        </div>
        <ManageBillingButton />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PRODUCTS.map((product) => {
          const sub = byProduct.get(product);
          const plan = sub?.planId ? planById(product, sub.planId) : undefined;
          const Icon = PRODUCT_ICON[product];
          const periodEnd = sub?.currentPeriodEnd ?? sub?.trialEndsAt ?? null;

          return (
            <Card key={product}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4.5" />
                  </div>
                  <div>
                    <CardTitle>{PRODUCT_LABELS[product]}</CardTitle>
                    <CardDescription>
                      {plan ? `${plan.name} plan` : "No plan yet"} ·{" "}
                      {statusLabel(sub?.status ?? "NONE", sub?.trialEndsAt ?? null)}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant={sub?.status === "ACTIVE" ? "default" : "secondary"}>{sub?.status ?? "None"}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {plan && plan.features.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {plan.features.map((f) => (
                      <li key={f}>• {f}</li>
                    ))}
                  </ul>
                )}

                {product === "QA_SENTINEL" && sub && (
                  <UsageMeter label="Reviews used this period" used={sub.reviewsUsedThisPeriod} total={sub.reviewQuota ?? null} />
                )}
                {product === "CRM" && sub && (
                  <UsageMeter label="Team members" used={seatsUsed} total={sub.seats ?? null} />
                )}

                {periodEnd && (
                  <p className="text-xs text-muted-foreground">
                    {sub?.status === "TRIALING" ? "Trial ends" : "Renews"} {periodEnd.toLocaleDateString()}
                  </p>
                )}

                <Button size="sm" render={<Link href={`/billing/${product}`} />}>
                  {sub ? "Change plan" : "View plans"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <CreditCard className="mt-0.5 size-4 shrink-0" />
        <p>
          QA Sentinel and CRM are billed completely independently — subscribe to one or both, and cancel either
          any time from the Stripe billing portal without affecting the other.
        </p>
      </div>
    </div>
  );
}
