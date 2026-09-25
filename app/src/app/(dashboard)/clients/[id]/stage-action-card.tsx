"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Client, Stage, CustomFieldDefinition } from "@/generated/prisma/client";
import { recordRmContactAction, moveToStageAction, updateClientDetailsAction } from "../actions";
import { CustomFieldInputs, parseCustomFieldsFromFormData } from "@/components/clients/custom-field-inputs";

type FullClient = Omit<Client, "dealValue"> & {
  dealValue: number | null;
  currentStage: Stage;
};

const CONTACT_METHODS = ["Phone", "WhatsApp", "In-person", "Email", "Other"];
const CONTACT_OUTCOMES = [
  "Connected",
  "Call back requested",
  "Interested",
  "Not interested",
  "Unreachable",
  "Wrong number",
];

export function StageActionCard({
  client,
  stages,
  customFieldDefinitions,
}: {
  client: FullClient;
  stages: Stage[];
  customFieldDefinitions: CustomFieldDefinition[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Current Stage: {client.currentStage.name}</CardTitle>
        <CardDescription>
          {client.status === "COMPLETED"
            ? "This deal is complete."
            : "Log contact, move the client forward, or update deal details."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {client.status !== "COMPLETED" && (
          <>
            <MoveStageForm clientId={client.id} currentStageId={client.currentStageId} stages={stages} />
            <Separator />
            <RmContactForm clientId={client.id} />
            <Separator />
          </>
        )}
        <DetailsForm client={client} customFieldDefinitions={customFieldDefinitions} />
      </CardContent>
    </Card>
  );
}

function MoveStageForm({
  clientId,
  currentStageId,
  stages,
}: {
  clientId: string;
  currentStageId: string;
  stages: Stage[];
}) {
  const [toStageId, setToStageId] = useState(currentStageId);
  const [pending, setPending] = useState(false);

  async function handleMove() {
    if (toStageId === currentStageId) return;
    setPending(true);
    try {
      await moveToStageAction(clientId, toStageId);
      toast.success("Stage updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move stage");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <Field className="flex-1">
        <FieldLabel htmlFor="moveToStage">Move to stage</FieldLabel>
        <Select value={toStageId} onValueChange={(v) => v && setToStageId(v)}>
          <SelectTrigger id="moveToStage" className="w-full">
            <SelectValue>{(v: string) => stages.find((s) => s.id === v)?.name ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
                {stage.isTerminal ? " (Won)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button onClick={handleMove} disabled={pending || toStageId === currentStageId}>
        {pending ? "Moving..." : "Move"}
      </Button>
    </div>
  );
}

function RmContactForm({ clientId }: { clientId: string }) {
  const [outcome, setOutcome] = useState(CONTACT_OUTCOMES[0]);
  const [pending, setPending] = useState(false);
  const requiresNotes = ["Not interested", "Unreachable", "Wrong number"].includes(outcome);
  const requiresNextAction = ["Call back requested", "Interested"].includes(outcome);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await recordRmContactAction(clientId, {
        contactMethod: formData.get("contactMethod") as never,
        contactOutcome: outcome as never,
        notes: String(formData.get("notes") || "") || undefined,
        nextAction: String(formData.get("nextAction") || "") || undefined,
        nextActionDate: String(formData.get("nextActionDate") || "") || undefined,
      });
      toast.success("Contact recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record contact");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <p className="mb-3 text-sm font-medium">Log Contact</p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="contactMethod">Contact Method</FieldLabel>
          <Select name="contactMethod" defaultValue={CONTACT_METHODS[0]}>
            <SelectTrigger id="contactMethod" className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTACT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="contactOutcome">Outcome</FieldLabel>
          <Select value={outcome} onValueChange={(v) => v && setOutcome(v)}>
            <SelectTrigger id="contactOutcome" className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTACT_OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">
            Notes {requiresNotes && <span className="text-destructive">(required)</span>}
          </FieldLabel>
          <Textarea id="notes" name="notes" rows={2} required={requiresNotes} />
        </Field>
        <Field>
          <FieldLabel htmlFor="nextAction">
            Next Action {requiresNextAction && <span className="text-destructive">(required)</span>}
          </FieldLabel>
          <Input id="nextAction" name="nextAction" required={requiresNextAction} placeholder="Call back tomorrow" />
        </Field>
        <Field>
          <FieldLabel htmlFor="nextActionDate">Next Action Date</FieldLabel>
          <Input id="nextActionDate" name="nextActionDate" type="datetime-local" />
        </Field>
      </FieldGroup>
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? "Saving..." : "Record Contact"}
      </Button>
    </form>
  );
}

function DetailsForm({
  client,
  customFieldDefinitions,
}: {
  client: FullClient;
  customFieldDefinitions: CustomFieldDefinition[];
}) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const dealValueRaw = formData.get("dealValue");
      await updateClientDetailsAction(client.id, {
        dealValue: dealValueRaw === "" || dealValueRaw === null ? null : Number(dealValueRaw),
        customFields: parseCustomFieldsFromFormData(formData, customFieldDefinitions),
      });
      toast.success("Details updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update details");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <p className="mb-3 text-sm font-medium">Deal Details</p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="dealValue">Deal Value</FieldLabel>
          <Input id="dealValue" name="dealValue" type="number" step="0.01" defaultValue={client.dealValue ?? ""} />
        </Field>
        <CustomFieldInputs
          definitions={customFieldDefinitions}
          defaultValues={(client.customFields as Record<string, unknown> | null) ?? undefined}
        />
      </FieldGroup>
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? "Saving..." : "Save Details"}
      </Button>
    </form>
  );
}
