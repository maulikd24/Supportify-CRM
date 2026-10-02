"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Product } from "@/generated/prisma/client";
import type { BillingInterval, PlanTier } from "@/lib/billing/plans";
import { CheckoutButton } from "./checkout-button";

/** Plan cards with a Monthly / Annual toggle (shown once annual Stripe prices exist). */
export function PlanPicker({
  product,
  plans,
  currentPlanId,
  currentInterval,
  annualAvailable,
}: {
  product: Product;
  plans: PlanTier[];
  currentPlanId: string | null;
  currentInterval: BillingInterval | null;
  annualAvailable: boolean;
}) {
  const [interval, setInterval] = useState<BillingInterval>(currentInterval === "year" && annualAvailable ? "year" : "month");

  return (
    <div className="flex flex-col gap-4">
      {annualAvailable && (
        <div role="group" aria-label="Billing period" className="flex w-fit rounded-md border border-border bg-card p-0.5">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => setInterval(value)}
              className={cn(
                "rounded-[5px] px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground",
                interval === value && "bg-primary text-primary-foreground hover:text-primary-foreground",
              )}
            >
              {value === "month" ? "Monthly" : "Annual · 2 months free"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = currentPlanId === plan.id && (plan.contactSales || currentInterval === interval);
          const price = interval === "year" && plan.annualPriceLabel ? plan.annualPriceLabel : plan.priceLabel;
          return (
            <section
              key={plan.id}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-5",
                plan.featured ? "border-primary ring-3 ring-primary/15" : "border-border",
                isCurrent && "border-success",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading text-[15px] font-bold">{plan.name}</h3>
                {isCurrent ? <Badge variant="success">Current</Badge> : plan.featured ? <Badge variant="soft">Most popular</Badge> : null}
              </div>
              <p className="mt-3 font-heading text-2xl font-bold tabular-nums">{price}</p>
              {interval === "year" && plan.annualPriceLabel && <p className="text-[11px] text-muted-foreground">{plan.priceLabel} billed monthly</p>}
              <ul className="mt-4 flex flex-1 flex-col gap-2 border-t border-border pt-4">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-[13px]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <CheckoutButton
                  product={product}
                  planId={plan.id}
                  interval={interval}
                  contactSales={Boolean(plan.contactSales)}
                  disabled={isCurrent}
                  featured={plan.featured}
                />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
