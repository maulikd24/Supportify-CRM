"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteCustomFieldAction } from "./actions";

export function CustomFieldRowActions({ fieldId }: { fieldId: string }) {
  async function handleDelete() {
    try {
      await deleteCustomFieldAction(fieldId);
      toast.success("Field deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete field");
    }
  }

  return (
    <div className="flex justify-end">
      <Button size="sm" variant="destructive" onClick={handleDelete}>
        Delete
      </Button>
    </div>
  );
}
