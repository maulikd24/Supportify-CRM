"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveAuditorCommentAction } from "../actions";

export function AuditorCommentForm({ reviewId, initialComment }: { reviewId: string; initialComment: string }) {
  const [comment, setComment] = useState(initialComment);
  const [pending, setPending] = useState(false);

  async function handleSave() {
    setPending(true);
    try {
      await saveAuditorCommentAction(reviewId, comment);
      toast.success("Comment saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save comment");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        placeholder="Add a note for the agent or team lead..."
      />
      <Button size="sm" disabled={pending} onClick={handleSave} className="self-start">
        {pending ? "Saving..." : "Save comment"}
      </Button>
    </div>
  );
}
