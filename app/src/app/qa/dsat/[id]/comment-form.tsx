"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveDsatCommentAction } from "../actions";

export function CommentForm({ analysisId, initialComment }: { analysisId: string; initialComment: string }) {
  const [comment, setComment] = useState(initialComment);
  const [pending, setPending] = useState(false);

  async function handleSave() {
    setPending(true);
    try {
      await saveDsatCommentAction(analysisId, comment);
      toast.success("Note saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save note");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Add a coaching note..."
      />
      <Button size="sm" disabled={pending} onClick={handleSave} className="self-start">
        {pending ? "Saving..." : "Save note"}
      </Button>
    </div>
  );
}
