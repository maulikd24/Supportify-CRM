"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteJourneyAction } from "./actions";

export function JourneyRowActions({
  journeyId,
  journeyName,
  runCount,
  hasInFlightRuns,
}: {
  journeyId: string;
  journeyName: string;
  runCount: number;
  hasInFlightRuns: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await deleteJourneyAction(journeyId);
    } catch (error) {
      unstable_rethrow(error);
      toast.error(error instanceof Error ? error.message : "Failed to delete journey");
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="icon-sm"
            variant="destructive"
            title={hasInFlightRuns ? "Deactivate the journey first to delete it" : "Delete journey"}
            disabled={hasInFlightRuns}
          />
        }
      >
        <Trash2 className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {journeyName}?</DialogTitle>
          <DialogDescription>
            {runCount > 0
              ? `This cannot be undone. Run history for ${runCount} client(s) enrolled in this journey will be permanently erased.`
              : "This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "Deleting..." : "Delete journey"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
