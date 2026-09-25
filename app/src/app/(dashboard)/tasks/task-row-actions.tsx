"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { completeTaskAction } from "./actions";

export function TaskRowActions({ taskId }: { taskId: string }) {
  async function handleComplete() {
    try {
      await completeTaskAction(taskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete task");
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleComplete}>
      Mark done
    </Button>
  );
}
