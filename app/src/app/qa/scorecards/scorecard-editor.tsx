"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { MAX_CRITERIA, type ScorecardCriterion } from "@/lib/qa/scorecard-criteria";
import { createScorecardAction, deleteScorecardAction, setDefaultScorecardAction, updateScorecardAction } from "./actions";

type Row = { label: string; description: string; weight: string; autoFail: boolean; autoFailBelow: string };

function toRows(criteria: ScorecardCriterion[]): Row[] {
  return criteria.map((c) => ({
    label: c.label,
    description: c.description,
    weight: String(c.weight),
    autoFail: c.autoFailBelow != null,
    autoFailBelow: String(c.autoFailBelow ?? 50),
  }));
}

export function ScorecardEditorDialog({
  scorecard,
  starter,
  trigger,
}: {
  /** Existing scorecard to edit; omit to create one. */
  scorecard?: { id: string; name: string; criteria: ScorecardCriterion[] };
  /** Criteria a new scorecard starts from. */
  starter: ScorecardCriterion[];
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(scorecard?.name ?? "");
  const [rows, setRows] = useState<Row[]>(toRows(scorecard?.criteria ?? starter));
  const [pending, setPending] = useState(false);
  const totalWeight = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setPending(true);
    try {
      const input = {
        name,
        criteria: rows.map((r) => ({
          label: r.label,
          description: r.description,
          weight: Number(r.weight),
          autoFailBelow: r.autoFail ? Number(r.autoFailBelow) : null,
        })),
      };
      if (scorecard) await callAction(updateScorecardAction)(scorecard.id, input);
      else await callAction(createScorecardAction)(input);
      toast.success(scorecard ? "Scorecard saved" : "Scorecard created");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the scorecard");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(scorecard?.name ?? "");
          setRows(toRows(scorecard?.criteria ?? starter));
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{scorecard ? "Edit scorecard" : "New scorecard"}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="scorecard-name">Name</FieldLabel>
            <Input id="scorecard-name" value={name} maxLength={80} placeholder="e.g. Billing queue" onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="flex flex-col gap-3">
            {rows.map((row, i) => {
              const share = totalWeight > 0 ? Math.round(((Number(row.weight) || 0) / totalWeight) * 100) : 0;
              return (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field className="min-w-48 flex-1">
                      <FieldLabel htmlFor={`c-label-${i}`}>Criterion</FieldLabel>
                      <Input id={`c-label-${i}`} value={row.label} maxLength={60} onChange={(e) => update(i, { label: e.target.value })} />
                    </Field>
                    <Field className="w-28">
                      <FieldLabel htmlFor={`c-weight-${i}`}>Weight</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`c-weight-${i}`}
                          type="number"
                          min={1}
                          max={10}
                          value={row.weight}
                          onChange={(e) => update(i, { weight: e.target.value })}
                          className="w-16"
                        />
                        <span className="text-xs text-muted-foreground tabular-nums">{share}%</span>
                      </div>
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${row.label || "criterion"}`}
                      disabled={rows.length <= 1}
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Field className="mt-3">
                    <FieldLabel htmlFor={`c-desc-${i}`} className="sr-only">
                      What good looks like
                    </FieldLabel>
                    <Textarea
                      id={`c-desc-${i}`}
                      rows={2}
                      maxLength={400}
                      placeholder="What good looks like. The AI scores against this."
                      value={row.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                    />
                  </Field>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Field orientation="horizontal" className="w-auto">
                      <Switch id={`c-fail-${i}`} checked={row.autoFail} onCheckedChange={(v) => update(i, { autoFail: v })} />
                      <FieldLabel htmlFor={`c-fail-${i}`}>Critical: auto-fail the review below</FieldLabel>
                    </Field>
                    <Input
                      aria-label="Auto-fail threshold"
                      type="number"
                      min={1}
                      max={100}
                      value={row.autoFailBelow}
                      disabled={!row.autoFail}
                      onChange={(e) => update(i, { autoFailBelow: e.target.value })}
                      className="w-20"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length >= MAX_CRITERIA}
              onClick={() => setRows((prev) => [...prev, { label: "", description: "", weight: "1", autoFail: false, autoFailBelow: "50" }])}
            >
              <Plus /> Add criterion
            </Button>
            <FieldDescription>
              Up to {MAX_CRITERIA} criteria. The overall score is the weighted average; any critical criterion under its threshold makes it 0.
            </FieldDescription>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving..." : scorecard ? "Save changes" : "Create scorecard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScorecardRowActions({ id, name, isDefault }: { id: string; name: string; isDefault: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {!isDefault && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => callAction(setDefaultScorecardAction)(id), `${name} is now the default`)}>
          Make default
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete "${name}"? Past reviews keep their scores.`)) {
            run(() => callAction(deleteScorecardAction)(id), "Scorecard deleted");
          }
        }}
      >
        Delete
      </Button>
    </>
  );
}
