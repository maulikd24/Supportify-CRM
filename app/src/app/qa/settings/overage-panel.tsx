"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { saveOverageSettingsAction } from "./auto-review-actions";

export function OveragePanel({
  allowOverage: initialAllow,
  overageCap: initialCap,
  priceLabel,
  unavailableReason,
  canEdit,
}: {
  allowOverage: boolean;
  overageCap: number | null;
  priceLabel: string;
  unavailableReason?: string;
  canEdit: boolean;
}) {
  const [allow, setAllow] = useState(initialAllow);
  const [cap, setCap] = useState(initialCap != null ? String(initialCap) : "");
  const [pending, setPending] = useState(false);
  const disabled = !canEdit || Boolean(unavailableReason);

  async function save() {
    setPending(true);
    try {
      const parsedCap = cap.trim() === "" ? null : Math.max(1, Math.round(Number(cap)));
      const result = await saveOverageSettingsAction({ allowOverage: allow, overageCap: Number.isFinite(parsedCap) ? parsedCap : null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(allow ? "Overage reviews are on" : "Overage reviews are off");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save overage settings");
    } finally {
      setPending(false);
    }
  }

  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <Switch id="overage-allow" checked={allow} onCheckedChange={setAllow} disabled={disabled} />
        <div>
          <FieldLabel htmlFor="overage-allow">Keep reviewing after the plan quota is used up</FieldLabel>
          <FieldDescription>
            Extra reviews are billed at {priceLabel} each on your next invoice. When this is off, reviews pause until the next billing period.
          </FieldDescription>
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="overage-cap">Monthly cap on extra reviews</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="overage-cap"
            type="number"
            min={1}
            placeholder="No cap"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            disabled={disabled || !allow}
            className="w-32"
          />
          <span className="text-xs text-muted-foreground">
            {cap.trim() && Number(cap) > 0 ? `Up to ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cap) * Number(priceLabel.replace(/[^0-9.]/g, "")))} a month` : "Leave empty for no cap"}
          </span>
        </div>
      </Field>
      {unavailableReason ? (
        <p className="text-xs text-muted-foreground">{unavailableReason}</p>
      ) : canEdit ? (
        <div>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only organization owners and admins can change billing settings.</p>
      )}
    </FieldGroup>
  );
}
