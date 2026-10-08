"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { callAction } from "@/lib/actions/call-action";
import { updateAiDraftingAction } from "./actions";

export function AiDraftingPanel({
  settings,
  configured,
}: {
  settings: { enabled: boolean; tone: string; avoid: string };
  configured: boolean;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [tone, setTone] = useState(settings.tone);
  const [avoid, setAvoid] = useState(settings.avoid);
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await callAction(updateAiDraftingAction)({ enabled, tone, avoid });
      toast.success("AI drafting settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 border-t border-border p-5">
      {!configured && (
        <p className="text-xs text-muted-foreground">AI drafting isn&apos;t set up on this Supportify installation yet.</p>
      )}
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Allow AI drafting" />
        Let RMs draft replies with AI in the Inbox
      </label>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ai-tone">Tone</FieldLabel>
          <Textarea id="ai-tone" rows={2} maxLength={300} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Warm and concise. Use the client's first name." />
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-avoid">Things to avoid</FieldLabel>
          <Textarea id="ai-avoid" rows={3} maxLength={1000} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder={"Guaranteed returns\nDiscounts or fee waivers"} />
          <FieldDescription>One per line. Drafts never mention these.</FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
