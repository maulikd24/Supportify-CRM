"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { raiseDisputeAction, resolveDisputeAction } from "./actions";

export type ScoredCriterion = { key: string; label: string; score: number };

const OVERALL = "__overall";

export function RaiseDisputeDialog({ reviewId, criteria }: { reviewId: string; criteria: ScoredCriterion[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [criterion, setCriterion] = useState(OVERALL);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      await callAction(raiseDisputeAction)(reviewId, { criterionKey: criterion === OVERALL ? null : criterion, reason });
      toast.success("Dispute raised. An admin will review it.");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't raise the dispute");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Dispute score</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dispute this score</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="dispute-criterion">What&apos;s wrong?</FieldLabel>
            <Select value={criterion} onValueChange={(v) => setCriterion(v as string)}>
              <SelectTrigger id="dispute-criterion" className="w-full">
                <SelectValue>
                  {(v: string) => (v === OVERALL ? "The overall score" : (criteria.find((c) => c.key === v)?.label ?? v))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OVERALL}>The overall score</SelectItem>
                {criteria.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label} ({c.score})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="dispute-reason">Reason</FieldLabel>
            <Textarea
              id="dispute-reason"
              rows={4}
              maxLength={2000}
              placeholder="e.g. The SOP allows refunds within 30 days and this order was 12 days old."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldDescription>Owners and admins are notified and can uphold or adjust the score.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Sending..." : "Raise dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResolveDisputeDialog({
  disputeId,
  criteria,
  disputedKey,
}: {
  disputeId: string;
  criteria: ScoredCriterion[];
  /** Criterion under dispute (null = overall), listed first. */
  disputedKey: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"uphold" | "adjust">("uphold");
  const [note, setNote] = useState("");
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries(criteria.map((c) => [c.key, String(c.score)])));
  const [pending, setPending] = useState(false);
  const ordered = disputedKey ? [...criteria].sort((a, b) => Number(b.key === disputedKey) - Number(a.key === disputedKey)) : criteria;

  async function submit() {
    setPending(true);
    try {
      if (decision === "adjust") {
        const changed = Object.fromEntries(
          criteria.filter((c) => Number(scores[c.key]) !== c.score).map((c) => [c.key, Number(scores[c.key])]),
        );
        await callAction(resolveDisputeAction)(disputeId, { decision, note, scores: changed });
      } else {
        await callAction(resolveDisputeAction)(disputeId, { decision, note });
      }
      toast.success(decision === "adjust" ? "Score adjusted" : "Score upheld");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't resolve the dispute");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Resolve</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve dispute</DialogTitle>
        </DialogHeader>
        <Tabs value={decision} onValueChange={(v) => v && setDecision(v as "uphold" | "adjust")}>
          <TabsList>
            <TabsTrigger value="uphold">Uphold score</TabsTrigger>
            <TabsTrigger value="adjust">Adjust score</TabsTrigger>
          </TabsList>
        </Tabs>
        <FieldGroup>
          {decision === "adjust" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {ordered.map((c) => (
                <Field key={c.key}>
                  <FieldLabel htmlFor={`adj-${disputeId}-${c.key}`}>
                    {c.label}
                    {c.key === disputedKey && <span className="text-warning"> · disputed</span>}
                  </FieldLabel>
                  <Input
                    id={`adj-${disputeId}-${c.key}`}
                    type="number"
                    min={0}
                    max={100}
                    value={scores[c.key]}
                    onChange={(e) => setScores((prev) => ({ ...prev, [c.key]: e.target.value }))}
                    className="w-24"
                  />
                </Field>
              ))}
            </div>
          )}
          <Field>
            <FieldLabel htmlFor={`note-${disputeId}`}>Decision note</FieldLabel>
            <Textarea
              id={`note-${disputeId}`}
              rows={3}
              maxLength={2000}
              placeholder="Explain the decision to the person who raised it."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {decision === "adjust" && <FieldDescription>The overall score is recalculated from the scorecard&apos;s weights and critical items.</FieldDescription>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving..." : decision === "adjust" ? "Adjust score" : "Uphold score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
