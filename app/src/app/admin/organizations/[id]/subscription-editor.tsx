"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { adjustSubscriptionAction } from "./actions";
import { plansForProduct } from "@/lib/billing/plans";
import type { Product, ProductSubscription, SubscriptionStatus } from "@/generated/prisma/client";

const STATUSES: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"];

function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function SubscriptionEditor({
  organizationId,
  product,
  productLabel,
  subscription,
}: {
  organizationId: string;
  product: Product;
  productLabel: string;
  subscription: ProductSubscription | null;
}) {
  const [pending, setPending] = useState(false);
  const [planId, setPlanId] = useState(subscription?.planId ?? "");
  const [status, setStatus] = useState<SubscriptionStatus>(subscription?.status ?? "TRIALING");
  const plans = plansForProduct(product);
  const usesSeats = product === "CRM";

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await adjustSubscriptionAction(formData);
      toast.success(`${productLabel} subscription updated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update subscription");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {productLabel}
          {!subscription && <Badge variant="outline">No subscription</Badge>}
        </CardTitle>
        <CardDescription>
          {subscription
            ? `${subscription.reviewsUsedThisPeriod} reviews used this period`
            : "This organization has never subscribed to this product."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="product" value={product} />
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="status" value={status} />
          <FieldGroup>
            <Field>
              <FieldLabel>Plan</FieldLabel>
              <Select
                value={planId || "none"}
                onValueChange={(v) => setPlanId(v === "none" ? "" : (v as string))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => plans.find((p) => p.id === v)?.name ?? "None"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ({plan.priceLabel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {usesSeats ? (
              <Field>
                <FieldLabel htmlFor={`${product}-seats`}>Seats</FieldLabel>
                <Input
                  id={`${product}-seats`}
                  name="seats"
                  type="number"
                  min={1}
                  defaultValue={subscription?.seats ?? undefined}
                  placeholder="Unlimited"
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor={`${product}-reviewQuota`}>Review quota / period</FieldLabel>
                <Input
                  id={`${product}-reviewQuota`}
                  name="reviewQuota"
                  type="number"
                  min={1}
                  defaultValue={subscription?.reviewQuota ?? undefined}
                  placeholder="Unlimited"
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${product}-trialEndsAt`}>Trial ends</FieldLabel>
              <Input
                id={`${product}-trialEndsAt`}
                name="trialEndsAt"
                type="date"
                defaultValue={toDateInputValue(subscription?.trialEndsAt)}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={pending} className="mt-4">
            {pending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
