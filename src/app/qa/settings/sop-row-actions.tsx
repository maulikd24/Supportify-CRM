"use client";

import { useRef, useState } from "react";
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
import { updateSopAction, deleteSopAction } from "./actions";

export function SopRowActions({
  sopId,
  name,
  category,
  content,
}: {
  sopId: string;
  name: string;
  category: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleUpdate(formData: FormData) {
    setPending(true);
    try {
      await updateSopAction(sopId, formData);
      toast.success("SOP updated");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update SOP");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteSopAction(sopId);
      toast.success("SOP deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete SOP");
    }
  }

  return (
    <div className="flex gap-2 justify-end">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit SOP</DialogTitle>
          </DialogHeader>
          <form ref={formRef} action={handleUpdate}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`sop-name-${sopId}`}>Name</FieldLabel>
                <Input id={`sop-name-${sopId}`} name="name" required defaultValue={name} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`sop-category-${sopId}`}>Category</FieldLabel>
                <Input id={`sop-category-${sopId}`} name="category" defaultValue={category} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`sop-content-${sopId}`}>Content</FieldLabel>
                <Textarea id={`sop-content-${sopId}`} name="content" required rows={10} defaultValue={content} />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="destructive" onClick={handleDelete}>
        Delete
      </Button>
    </div>
  );
}
