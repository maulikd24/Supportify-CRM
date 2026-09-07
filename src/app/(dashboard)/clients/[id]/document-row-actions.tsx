"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateDocumentStatusAction } from "../actions";

export function DocumentRowActions({ documentId, status }: { documentId: string; status: string }) {
  async function setStatus(next: "VERIFIED" | "REJECTED") {
    try {
      await updateDocumentStatusAction(documentId, { status: next });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update document");
    }
  }

  if (status === "VERIFIED" || status === "REJECTED") return null;

  return (
    <div className="flex gap-1">
      <Button size="xs" variant="outline" onClick={() => setStatus("VERIFIED")}>
        Verify
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setStatus("REJECTED")}>
        Reject
      </Button>
    </div>
  );
}
