"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { completeTaskAction } from "./actions";
import { callAction } from "@/lib/actions/call-action";

export function TaskRowActions({ taskId }: { taskId: string }) {
  async function handleComplete() {
    try {
      await callAction(completeTaskAction)(taskId);
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
