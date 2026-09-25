"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Product } from "@/generated/prisma/client";
import { startTrialAction } from "./actions";

export function StartTrialButton({ product }: { product: Product }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await startTrialAction(product);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start the trial");
      setPending(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={pending}>
      {pending ? "Starting..." : "Start free trial"}
    </Button>
  );
}
