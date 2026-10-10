import Link from "next/link";
import { CreditCard, Radar, Sparkles, Users } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { PRODUCT_LABELS, launchedProducts, planById } from "@/lib/billing/plans";
import { getProductAccess } from "@/lib/billing/access";
import { subscriptionState } from "@/lib/billing/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManageBillingButton } from "./manage-billing-button";
import type { Product } from "@/generated/prisma/client";

const PRODUCT_ICON = {
  QA_SENTINEL: Sparkles,
  CRM: Users,
  CX_INTELLIGENCE: Radar,
} as const satisfies Record<Product, unknown>;

function UsageMeter({ label, used, total }: { label: string; used: number; total: number | null }) {
  if (total == null) {
    return (
      <p className="text-xs text-muted-foreground">
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
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-mist">
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
    prisma.user.count({ where: { orgRole: { not: "AGENT" }, organizationId: session.user.organizationId, isActive: true } }),
  ]);
  const byProduct = new Map(subscriptions.map((s) => [s.product, s]));
  const [crm, qa] = await Promise.all([
    getProductAccess(session.user.organizationId, "CRM"),
    getProductAccess(session.user.organizationId, "QA_SENTINEL"),
  ]);
  const access = new Map(
    await Promise.all(launchedProducts().map(async (p) => [p, (await getProductAccess(session.user.organizationId, p)).allowed] as const)),
  );
  // Nothing usable: say why the app keeps landing here (an ended trial looked like a live one).
  const lockedOut = [...access.values()].every((allowed) => !allowed);
  const hadTrial = subscriptions.some((s) => s.status === "TRIALING");
  // On one product only: show what the pair adds (support quality on every client record).
  const missing: Product | null = crm.allowed && !qa.allowed ? "QA_SENTINEL" : qa.allowed && !crm.allowed ? "CRM" : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[19px] font-extrabold">Billing</h2>
          <p className="text-sm text-muted-foreground">Manage your plan and usage for each product.</p>
        </div>
        <ManageBillingButton />
      </div>

      {lockedOut && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm">
          <p className="font-semibold">{hadTrial ? "Your free trial has ended" : "No active plan"}</p>
          <p className="mt-1 text-muted-foreground">
            Choose a plan for a product below to keep using Supportify. Your data is kept, and everything is back as soon as a
            plan is active.
          </p>
        </div>
      )}

      {missing && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Better together: add {PRODUCT_LABELS[missing]}</CardTitle>
              <CardDescription>
                With both products, each client record shows their support experience: recent QA scores, dissatisfaction
                findings, and an alert when a high-priority client&apos;s support quality drops.
              </CardDescription>
            </div>
            <Button size="sm" render={<Link href={`/billing/${missing}`} />}>
              See {PRODUCT_LABELS[missing]} plans
            </Button>
          </CardHeader>
        </Card>
      )}

      <div className={launchedProducts().length > 2 ? "grid gap-4 lg:grid-cols-2 xl:grid-cols-3" : "grid gap-4 lg:grid-cols-2"}>
        {launchedProducts().map((product) => {
          const sub = byProduct.get(product);
          const plan = sub?.planId ? planById(product, sub.planId) : undefined;
          const Icon = PRODUCT_ICON[product];
          const state = subscriptionState(sub ?? null, access.get(product) ?? false);

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
                      {plan ? `${plan.name} plan` : "No plan yet"} · {state.line}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant={state.tone}>{state.badge}</Badge>
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
                {product === "CX_INTELLIGENCE" && sub && (
                  <UsageMeter label="Conversations analysed this period" used={sub.analysesUsedThisPeriod} total={sub.analysisQuota ?? null} />
                )}

                <Button size="sm" render={<Link href={`/billing/${product}`} />}>
                  {access.get(product) ? "Change plan" : "Choose a plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <CreditCard className="mt-0.5 size-4 shrink-0" />
        <p>
          Each product is billed completely independently: subscribe to any of them, and cancel any one from the
          Stripe billing portal without affecting the others.
        </p>
      </div>
    </div>
  );
}
