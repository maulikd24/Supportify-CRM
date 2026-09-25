"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDocumentAction } from "../actions";

export function AddDocumentForm({ clientId }: { clientId: string }) {
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(formData: FormData) {
    const documentType = String(formData.get("documentType") || "").trim();
    if (!documentType) return;
    setPending(true);
    try {
      await addDocumentAction(clientId, documentType, false);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add document");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex items-center gap-2 pt-2">
      <Input ref={inputRef} name="documentType" placeholder="e.g. Signed Contract" className="h-8 text-sm" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Adding..." : "Add"}
      </Button>
    </form>
  );
}
