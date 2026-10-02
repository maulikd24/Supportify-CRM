"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setTemplateApprovedAction, deleteTemplateAction } from "./actions";
import { callAction } from "@/lib/actions/call-action";

export function TemplateRowActions({ templateId, approved }: { templateId: string; approved: boolean }) {
  async function handleToggleApproved() {
    try {
      await callAction(setTemplateApprovedAction)(templateId, !approved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update template");
    }
  }

  async function handleDelete() {
    try {
      await callAction(deleteTemplateAction)(templateId);
      toast.success("Template deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete template");
    }
  }

  return (
    <div className="flex gap-2 justify-end">
      <Button size="sm" variant="outline" onClick={handleToggleApproved}>
        {approved ? "Mark draft" : "Approve"}
      </Button>
      <Button size="sm" variant="destructive" onClick={handleDelete}>
        Delete
      </Button>
    </div>
  );
}
