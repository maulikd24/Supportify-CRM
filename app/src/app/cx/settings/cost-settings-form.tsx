"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { callAction } from "@/lib/actions/call-action";
import { COST_CHANNELS, MAX_RETENTION_MONTHS, type CostSettings } from "@/lib/cx/settings-shared";
import { saveCostSettingsAction } from "./actions";

const CHANNEL_LABEL: Record<(typeof COST_CHANNELS)[number] | "default", string> = {
  default: "Any channel",
  email: "Email",
  chat: "Chat",
  voice: "Voice",
  social: "Social",
};

/** Text-field state for a number setting; blank means "not set". */
const str = (n: number | null, scale = 1) => (n == null ? "" : String(Math.round(n * scale * 100) / 100));
const num = (s: string, scale = 1) => (s.trim() === "" ? null : Number(s) / scale);

export function CostSettingsForm({ settings, canEdit }: { settings: CostSettings; canEdit: boolean }) {
  const [currency, setCurrency] = useState(settings.currency);
  const [perContact, setPerContact] = useState(
    Object.fromEntries(Object.entries(settings.costPerContact).map(([k, v]) => [k, str(v)])) as Record<string, string>,
  );
  const [fields, setFields] = useState({
    agentHourlyCost: str(settings.agentHourlyCost),
    averageOrderValue: str(settings.averageOrderValue),
    customerLifetimeVal: str(settings.customerLifetimeVal),
    churnPropensity: str(settings.churnPropensity, 100),
    deflectionRate: str(settings.deflectionRate, 100),
    retentionMonths: String(settings.retentionMonths),
  });
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await callAction(saveCostSettingsAction)({
        currency,
        costPerContact: Object.fromEntries(Object.entries(perContact).map(([k, v]) => [k, num(v)])) as CostSettings["costPerContact"],
        agentHourlyCost: num(fields.agentHourlyCost),
        averageOrderValue: num(fields.averageOrderValue),
        customerLifetimeVal: num(fields.customerLifetimeVal),
        churnPropensity: num(fields.churnPropensity, 100),
        deflectionRate: num(fields.deflectionRate, 100),
        retentionMonths: Number(fields.retentionMonths),
      });
      toast.success("Settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  const moneyInput = (id: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void) => (
    <Input id={id} inputMode="decimal" value={value} onChange={onChange} disabled={!canEdit} placeholder="Not set" />
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-5 border-t border-border p-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="cx-currency">Currency</FieldLabel>
          <Input id="cx-currency" className="w-28" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={!canEdit} />
        </Field>
      </FieldGroup>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Cost of handling one contact</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["default", ...COST_CHANNELS] as const).map((channel) => (
            <Field key={channel}>
              <FieldLabel htmlFor={`cx-cost-${channel}`}>{CHANNEL_LABEL[channel]}</FieldLabel>
              {moneyInput(`cx-cost-${channel}`, perContact[channel] ?? "", (e) => setPerContact((p) => ({ ...p, [channel]: e.target.value })))}
            </Field>
          ))}
        </div>
        <FieldDescription className="mt-2">Channels left blank use the &quot;Any channel&quot; cost.</FieldDescription>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="cx-hourly">Agent cost per hour</FieldLabel>
          {moneyInput("cx-hourly", fields.agentHourlyCost, set("agentHourlyCost"))}
        </Field>
        <Field>
          <FieldLabel htmlFor="cx-aov">Average order value</FieldLabel>
          {moneyInput("cx-aov", fields.averageOrderValue, set("averageOrderValue"))}
        </Field>
        <Field>
          <FieldLabel htmlFor="cx-ltv">Customer lifetime value</FieldLabel>
          {moneyInput("cx-ltv", fields.customerLifetimeVal, set("customerLifetimeVal"))}
        </Field>
        <Field>
          <FieldLabel htmlFor="cx-churn">Churn among at-risk customers (%)</FieldLabel>
          {moneyInput("cx-churn", fields.churnPropensity, set("churnPropensity"))}
        </Field>
        <Field>
          <FieldLabel htmlFor="cx-deflect">Deflectable contacts automation could absorb (%)</FieldLabel>
          {moneyInput("cx-deflect", fields.deflectionRate, set("deflectionRate"))}
        </Field>
        <Field>
          <FieldLabel htmlFor="cx-retention">Keep conversations for (months)</FieldLabel>
          <Input id="cx-retention" inputMode="numeric" value={fields.retentionMonths} onChange={set("retentionMonths")} disabled={!canEdit} />
          <FieldDescription>1 to {MAX_RETENTION_MONTHS}. Older conversations are deleted.</FieldDescription>
        </Field>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}
