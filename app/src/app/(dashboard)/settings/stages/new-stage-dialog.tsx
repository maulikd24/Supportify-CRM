"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createStageAction } from "./actions";

export function NewStageDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createStageAction(formData);
      toast.success("Stage added");
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add stage");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Stage
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Stage</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="stage-name">Name</FieldLabel>
              <Input id="stage-name" name="name" required placeholder="Negotiation" />
            </Field>
            <Field>
              <FieldLabel htmlFor="stage-sla">SLA (hours)</FieldLabel>
              <Input id="stage-sla" name="slaHours" type="number" min={0} defaultValue={24} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add Stage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
