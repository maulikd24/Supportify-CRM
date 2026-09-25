"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CalendarPlus, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { MessageSuggestion } from "@/lib/copilot/message-suggestion";
import { createTaskAction } from "@/app/(dashboard)/tasks/actions";

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CopilotQuickActions({
  clientId,
  assignedToId,
  suggestedFollowUp,
  messageSuggestion,
  users,
}: {
  clientId: string;
  assignedToId: string | null;
  suggestedFollowUp: { title: string; dueAtIso: string };
  messageSuggestion: MessageSuggestion | null;
  users: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createTaskAction(formData);
      toast.success("Follow-up scheduled");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to schedule follow-up");
    } finally {
      setPending(false);
    }
  }

  const messageHref = messageSuggestion
    ? `/clients/${clientId}?suggestChannel=${messageSuggestion.channel}&suggestTemplateId=${messageSuggestion.templateId}&suggestVars=${encodeURIComponent(JSON.stringify(messageSuggestion.variables))}#send-message`
    : null;

  return (
    <div className="flex items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" title="Schedule follow-up" />}>
          <CalendarPlus className="size-4" />
          <span className="hidden sm:inline">Follow-up</span>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Follow-up</DialogTitle>
          </DialogHeader>
          <form ref={formRef} action={handleSubmit}>
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="source" value="copilot" />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`nba-title-${clientId}`}>Task</FieldLabel>
                <Input id={`nba-title-${clientId}`} name="title" defaultValue={suggestedFollowUp.title} required />
              </Field>
              <Field>
                <FieldLabel htmlFor={`nba-due-${clientId}`}>Due</FieldLabel>
                <Input
                  id={`nba-due-${clientId}`}
                  name="dueAt"
                  type="datetime-local"
                  defaultValue={toDatetimeLocal(suggestedFollowUp.dueAtIso)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`nba-assignee-${clientId}`}>Assign to</FieldLabel>
                <Select name="assignedToId" defaultValue={assignedToId ?? undefined}>
                  <SelectTrigger id={`nba-assignee-${clientId}`} className="w-full">
                    <SelectValue placeholder="Select assignee">
                      {(value: string) => users.find((u) => u.id === value)?.name ?? "Select assignee"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={pending}>
                {pending ? "Scheduling..." : "Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {messageHref && (
        <Button size="sm" variant="outline" title="Suggested message" render={<Link href={messageHref} />}>
          <MessageSquarePlus className="size-4" />
          <span className="hidden sm:inline">Message</span>
        </Button>
      )}
    </div>
  );
}
