"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Product } from "@/generated/prisma/client";
import { startCheckoutAction } from "./actions";

export function CheckoutButton({
  product,
  planId,
  contactSales,
  disabled,
}: {
  product: Product;
  planId: string;
  contactSales: boolean;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);

  if (contactSales) {
    return (
      <Button size="sm" variant="outline" render={<a href="mailto:sales@supportify.co.in" />}>
        Contact sales
      </Button>
    );
  }

  async function handleClick() {
    setPending(true);
    try {
      await startCheckoutAction(product, planId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
      setPending(false);
    }
  }

  return (
    <Button size="sm" disabled={disabled || pending} onClick={handleClick}>
      {disabled ? "Current plan" : pending ? "Redirecting..." : "Subscribe"}
    </Button>
  );
}
