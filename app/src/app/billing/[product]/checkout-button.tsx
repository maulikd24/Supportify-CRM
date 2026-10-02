"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Product } from "@/generated/prisma/client";
import type { BillingInterval } from "@/lib/billing/plans";
import { startCheckoutAction } from "./actions";
import { callAction } from "@/lib/actions/call-action";

export function CheckoutButton({
  product,
  planId,
  interval,
  contactSales,
  disabled,
  featured,
}: {
  product: Product;
  planId: string;
  interval: BillingInterval;
  contactSales: boolean;
  disabled: boolean;
  featured?: boolean;
}) {
  const [pending, setPending] = useState(false);

  if (contactSales) {
    return (
      <Button className="w-full" variant="outline" nativeButton={false} render={<a href="mailto:sales@supportify.co.in" />}>
        Contact sales
      </Button>
    );
  }

  async function handleClick() {
    setPending(true);
    try {
      await callAction(startCheckoutAction)(product, planId, interval);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
      setPending(false);
    }
  }

  return (
    <Button className="w-full" variant={featured ? "default" : "outline"} disabled={disabled || pending} onClick={handleClick}>
      {disabled ? "Current plan" : pending ? "Redirecting..." : "Subscribe"}
    </Button>
  );
}
