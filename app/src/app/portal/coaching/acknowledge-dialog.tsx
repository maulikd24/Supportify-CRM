"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { acknowledgeCoachingAction } from "../actions";

export function AcknowledgeCoachingDialog({ id, coachName }: { id: string; coachName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      await callAction(acknowledgeCoachingAction)(id, { agentResponse: response });
      toast.success(`Thanks! ${coachName} has been notified.`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't acknowledge the session");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Acknowledge</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Acknowledge coaching</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`ack-${id}`}>Your response</FieldLabel>
          <Textarea
            id={`ack-${id}`}
            rows={4}
            maxLength={4000}
            placeholder="What you'll do differently, or any questions for your coach."
            value={response}
            onChange={(e) => setResponse(e.target.value)}
          />
          <FieldDescription>{coachName} will see this and be notified.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Sending..." : "Acknowledge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
