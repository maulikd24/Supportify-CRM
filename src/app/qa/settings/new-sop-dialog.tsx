"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createSopAction } from "./actions";

export function NewSopDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createSopAction(formData);
      toast.success("SOP created");
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create SOP");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New SOP
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New SOP</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sop-name">Name</FieldLabel>
              <Input id="sop-name" name="name" required placeholder="Refund Policy" />
            </Field>
            <Field>
              <FieldLabel htmlFor="sop-category">Category</FieldLabel>
              <Input id="sop-category" name="category" defaultValue="general" />
            </Field>
            <Field>
              <FieldLabel htmlFor="sop-content">Content</FieldLabel>
              <Textarea id="sop-content" name="content" required rows={10} placeholder="Paste the SOP text..." />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create SOP"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
