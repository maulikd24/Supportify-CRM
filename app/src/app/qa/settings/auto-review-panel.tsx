"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runAutoReviewNowAction, saveAutoReviewSettingsAction } from "./auto-review-actions";

const DEFAULT_CHOICE = "__default";

export type AutoReviewSettings = {
  enabled: boolean;
  sopId: string | null;
  scorecardId: string | null;
  samplePercent: number;
  alwaysReviewBadCsat: boolean;
  includeTags: string[];
  excludeTags: string[];
};

export function AutoReviewPanel({
  initial,
  sops,
  scorecards,
  canEdit,
}: {
  initial: AutoReviewSettings;
  sops: { id: string; name: string }[];
  /** Custom scorecards; empty when the plan doesn't include them. */
  scorecards: { id: string; name: string; isDefault: boolean }[];
  canEdit: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [sopId, setSopId] = useState(initial.sopId ?? sops[0]?.id ?? null);
  const [scorecardId, setScorecardId] = useState(initial.scorecardId ?? DEFAULT_CHOICE);
  const [samplePercent, setSamplePercent] = useState(String(initial.samplePercent));
  const [badCsat, setBadCsat] = useState(initial.alwaysReviewBadCsat);
  const [includeTags, setIncludeTags] = useState(initial.includeTags.join(", "));
  const [excludeTags, setExcludeTags] = useState(initial.excludeTags.join(", "));
  const [pending, setPending] = useState<"save" | "run" | null>(null);

  async function save() {
    setPending("save");
    try {
      const result = await saveAutoReviewSettingsAction({
        enabled,
        sopId,
        scorecardId: scorecardId === DEFAULT_CHOICE ? null : scorecardId,
        samplePercent: Math.min(100, Math.max(0, Math.round(Number(samplePercent) || 0))),
        alwaysReviewBadCsat: badCsat,
        includeTags,
        excludeTags,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(enabled ? "Auto-review is on" : "Auto-review settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save settings");
    } finally {
      setPending(null);
    }
  }

  async function runNow() {
    setPending("run");
    try {
      const result = await runAutoReviewNowAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { found, queued } = result;
      toast.success(
        queued > 0
          ? `Queued ${queued} of ${found} solved tickets. Reviews will appear over the next few minutes.`
          : `Checked ${found} solved tickets; none new to review.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't check Zendesk");
    } finally {
      setPending(null);
    }
  }

  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <Switch id="auto-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
        <div>
          <FieldLabel htmlFor="auto-enabled">Review solved tickets automatically</FieldLabel>
          <FieldDescription>Supportify checks Zendesk once a day and scores the tickets your rules select.</FieldDescription>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="auto-sop">Score against SOP</FieldLabel>
          <Select value={sopId ?? undefined} onValueChange={(v) => setSopId(v as string)} disabled={!canEdit || sops.length === 0}>
            <SelectTrigger id="auto-sop" className="w-full">
              <SelectValue placeholder="Add an SOP first">{(v: string) => sops.find((s) => s.id === v)?.name ?? "Select SOP"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sops.map((sop) => (
                <SelectItem key={sop.id} value={sop.id}>
                  {sop.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {scorecards.length > 0 && (
          <Field>
            <FieldLabel htmlFor="auto-scorecard">Scorecard</FieldLabel>
            <Select value={scorecardId} onValueChange={(v) => setScorecardId(v as string)} disabled={!canEdit}>
              <SelectTrigger id="auto-scorecard" className="w-full">
                <SelectValue>
                  {(v: string) => (v === DEFAULT_CHOICE ? "Organization default" : scorecards.find((s) => s.id === v)?.name ?? "Organization default")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_CHOICE}>Organization default</SelectItem>
                {scorecards.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="auto-sample">Random sample</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="auto-sample"
              type="number"
              min={0}
              max={100}
              value={samplePercent}
              onChange={(e) => setSamplePercent(e.target.value)}
              disabled={!canEdit}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">% of solved tickets</span>
          </div>
        </Field>
      </div>

      <Field orientation="horizontal">
        <Switch id="auto-csat" checked={badCsat} onCheckedChange={setBadCsat} disabled={!canEdit} />
        <div>
          <FieldLabel htmlFor="auto-csat">Always review tickets with a bad CSAT rating</FieldLabel>
          <FieldDescription>Every ticket the customer rated &ldquo;bad&rdquo; is reviewed, on top of the random sample.</FieldDescription>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="auto-include">Only tickets tagged</FieldLabel>
          <Input id="auto-include" placeholder="e.g. billing, refunds (empty = all)" value={includeTags} onChange={(e) => setIncludeTags(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field>
          <FieldLabel htmlFor="auto-exclude">Never tickets tagged</FieldLabel>
          <Input id="auto-exclude" placeholder="e.g. spam, internal" value={excludeTags} onChange={(e) => setExcludeTags(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending !== null}>
            {pending === "save" ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" onClick={runNow} disabled={pending !== null || !initial.enabled}>
            {pending === "run" ? "Checking..." : "Check Zendesk now"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only organization owners and admins can change auto-review.</p>
      )}
    </FieldGroup>
  );
}
