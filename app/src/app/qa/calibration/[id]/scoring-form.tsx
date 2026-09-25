"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { submitCalibrationEntryAction } from "../actions";

export function ScoringForm({ sessionId, criteria }: { sessionId: string; criteria: [string, string][] }) {
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await submitCalibrationEntryAction(sessionId, formData);
      toast.success("Score submitted");
      setSubmitted(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit score");
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return <p className="text-sm text-muted-foreground">Your score has been recorded. Thanks for calibrating.</p>;
  }

  return (
    <form action={handleSubmit}>
      <FieldGroup>
        {criteria.map(([key, label]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`score-${key}`}>{label}</FieldLabel>
            <Input id={`score-${key}`} name={key} type="number" min={0} max={100} required className="w-24" />
          </Field>
        ))}
        <Field>
          <FieldLabel htmlFor="notes">Notes (optional)</FieldLabel>
          <Textarea id="notes" name="notes" rows={3} placeholder="What stood out while scoring this ticket?" />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "Submitting..." : "Submit score"}
      </Button>
    </form>
  );
}
