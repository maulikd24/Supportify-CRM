"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { unstable_rethrow } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createJourneyAction } from "./actions";

export function NewJourneyDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");

  async function handleCreate() {
    setPending(true);
    try {
      await createJourneyAction(name);
    } catch (error) {
      unstable_rethrow(error);
      toast.error(error instanceof Error ? error.message : "Failed to create journey");
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Journey
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Journey</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="journey-name">Name</FieldLabel>
          <Input
            id="journey-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New Client Follow-up"
          />
        </Field>
        <DialogFooter className="mt-4">
          <Button onClick={handleCreate} disabled={pending}>
            {pending ? "Creating..." : "Create Journey"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
