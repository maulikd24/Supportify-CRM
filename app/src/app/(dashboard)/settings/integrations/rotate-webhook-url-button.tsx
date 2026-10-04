"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { rotateWebhookTokenAction } from "./actions";

/** Issues a new secret webhook URL for one provider; the old URL stops working immediately. */
export function RotateWebhookUrlButton({ provider }: { provider: string }) {
  const [pending, startTransition] = useTransition();

  function handleRotate() {
    if (!window.confirm("Generate a new webhook URL? The current URL stops working immediately — update it in the provider's settings.")) {
      return;
    }
    startTransition(async () => {
      try {
        await rotateWebhookTokenAction(provider);
        toast.success("New webhook URL generated");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rotate webhook URL");
      }
    });
  }

  return (
    <Button size="sm" variant="outline" className="shrink-0 font-sans" onClick={handleRotate} disabled={pending}>
      Rotate
    </Button>
  );
}
