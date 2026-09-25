"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { deleteOrganizationAction } from "./actions";

export function DeleteOrganizationDialog({ organizationName }: { organizationName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    try {
      await deleteOrganizationAction(confirmName);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete organization");
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>Delete Organization</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {organizationName}?</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="confirm-org-name">
            Type <strong>{organizationName}</strong> to confirm
          </FieldLabel>
          <Input id="confirm-org-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          <FieldDescription>This immediately and permanently deletes all data. There is no undo.</FieldDescription>
        </Field>
        <DialogFooter className="mt-4">
          <Button variant="destructive" disabled={pending || confirmName !== organizationName} onClick={handleDelete}>
            {pending ? "Deleting..." : "Permanently delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
