"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { closeCalibrationSessionAction } from "../actions";

export function CloseSessionButton({ sessionId }: { sessionId: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await closeCalibrationSessionAction(sessionId);
      toast.success("Session closed — results are now visible to everyone");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to close session");
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={pending}>
      {pending ? "Closing..." : "Close session"}
    </Button>
  );
}
