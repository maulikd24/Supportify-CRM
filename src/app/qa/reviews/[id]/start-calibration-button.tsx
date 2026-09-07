"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { startCalibrationAction } from "@/app/qa/calibration/actions";

export function StartCalibrationButton({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const { sessionId } = await startCalibrationAction(reviewId);
      router.push(`/qa/calibration/${sessionId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start calibration");
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={pending}>
      {pending ? "Starting..." : "Start Calibration"}
    </Button>
  );
}
