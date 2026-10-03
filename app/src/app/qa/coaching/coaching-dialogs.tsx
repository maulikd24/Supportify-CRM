"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { cn } from "@/lib/utils";
import { createCoachingAction, updateCoachingAction } from "./actions";

export type AgentOption = { email: string; name: string };

export function NewCoachingDialog({
  agents,
  focusOptions,
  defaults,
  defaultOpen = false,
  trigger,
}: {
  agents: AgentOption[];
  /** Criterion labels coaches can pick as focus areas. */
  focusOptions: string[];
  defaults?: { agentEmail?: string; reviewId?: string; focusAreas?: string[] };
  defaultOpen?: boolean;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [agentEmail, setAgentEmail] = useState(defaults?.agentEmail ?? agents[0]?.email ?? "");
  const [focus, setFocus] = useState<string[]>(defaults?.focusAreas ?? []);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const lockedAgent = Boolean(defaults?.reviewId);

  function toggle(label: string) {
    setFocus((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  }

  async function submit() {
    setPending(true);
    try {
      await callAction(createCoachingAction)({ agentEmail, reviewId: defaults?.reviewId ?? null, focusAreas: focus, notes, dueDate: dueDate || null });
      toast.success("Coaching session assigned");
      setOpen(false);
      setNotes("");
      setDueDate("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't assign coaching");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign coaching</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="coach-agent">Agent</FieldLabel>
            <Select value={agentEmail} onValueChange={(v) => setAgentEmail(v as string)} disabled={lockedAgent || agents.length === 0}>
              <SelectTrigger id="coach-agent" className="w-full">
                <SelectValue placeholder="No reviewed agents yet">{(v: string) => agents.find((a) => a.email === v)?.name ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.email} value={a.email}>
                    {a.name}
                    {a.name !== a.email && <span className="text-muted-foreground"> · {a.email}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {focusOptions.length > 0 && (
            <Field>
              <FieldLabel>Focus areas</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {focusOptions.map((label) => {
                  const on = focus.includes(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(label)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="coach-notes">Coaching notes</FieldLabel>
            <Textarea
              id="coach-notes"
              rows={5}
              maxLength={4000}
              placeholder="What went well, what to change, and an example of a better reply."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="coach-due">Due date (optional)</FieldLabel>
            <Input id="coach-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-44" />
            <FieldDescription>Sessions past their due date are flagged as overdue.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !agentEmail}>
            {pending ? "Assigning..." : "Assign coaching"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UpdateCoachingDialog({
  id,
  status,
  agentName,
  notes,
  focusAreas,
}: {
  id: string;
  status: "ASSIGNED" | "ACKNOWLEDGED";
  agentName: string;
  notes: string;
  focusAreas: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agentResponse, setAgentResponse] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function update(next: "ACKNOWLEDGED" | "COMPLETED" | "CANCELLED") {
    setPending(next);
    try {
      await callAction(updateCoachingAction)(id, { status: next, agentResponse, outcome });
      toast.success(next === "ACKNOWLEDGED" ? "Marked as acknowledged" : next === "COMPLETED" ? "Coaching completed" : "Coaching cancelled");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the session");
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Update</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Coaching for {agentName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {focusAreas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {focusAreas.map((f) => (
                <Badge key={f} variant="soft">
                  {f}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{notes}</p>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`resp-${id}`}>Agent&apos;s response (optional)</FieldLabel>
            <Textarea id={`resp-${id}`} rows={3} maxLength={4000} placeholder="What the agent took away, in their words." value={agentResponse} onChange={(e) => setAgentResponse(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`outcome-${id}`}>Outcome (optional)</FieldLabel>
            <Textarea id={`outcome-${id}`} rows={2} maxLength={4000} placeholder="How it went and any follow-up." value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => update("CANCELLED")} disabled={pending !== null}>
            {pending === "CANCELLED" ? "Cancelling..." : "Cancel session"}
          </Button>
          {status === "ASSIGNED" && (
            <Button variant="outline" onClick={() => update("ACKNOWLEDGED")} disabled={pending !== null}>
              {pending === "ACKNOWLEDGED" ? "Saving..." : "Agent acknowledged"}
            </Button>
          )}
          <Button onClick={() => update("COMPLETED")} disabled={pending !== null}>
            {pending === "COMPLETED" ? "Saving..." : "Mark complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
