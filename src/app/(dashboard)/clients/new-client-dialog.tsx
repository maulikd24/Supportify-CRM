"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createClientAction } from "./actions";
import { LEAD_SOURCES, CLIENT_TYPES } from "@/lib/clients/options";
import { CustomFieldInputs } from "@/components/clients/custom-field-inputs";
import type { CustomFieldDefinition } from "@/generated/prisma/client";

type UserOption = { id: string; name: string };
type DuplicateInfo = { id: string; name: string; clientCode: string; mobile: string; email: string | null };

export function NewClientDialog({
  users,
  customFieldDefinitions,
}: {
  users: UserOption[];
  customFieldDefinitions: CustomFieldDefinition[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const result = await createClientAction(formData);
      if (result.duplicate) {
        setDuplicate(result.duplicate);
        return;
      }
      toast.success("Client created");
      setOpen(false);
      setDuplicate(null);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client");
    } finally {
      setPending(false);
    }
  }

  async function handleCreateAnyway() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("allowDuplicate", "true");
    setPending(true);
    try {
      await createClientAction(formData);
      toast.success("Client created");
      setOpen(false);
      setDuplicate(null);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDuplicate(null); }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Client
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Client</DialogTitle>
        </DialogHeader>

        {duplicate && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">A matching active client already exists</p>
            <p className="text-muted-foreground mt-1">
              <Link href={`/clients/${duplicate.id}`} className="underline">
                {duplicate.name} ({duplicate.clientCode})
              </Link>{" "}
              — {duplicate.mobile}
              {duplicate.email ? ` · ${duplicate.email}` : ""}
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={handleCreateAnyway} disabled={pending}>
              Create Anyway
            </Button>
          </div>
        )}

        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Full Name</FieldLabel>
              <Input id="name" name="name" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="mobile">Mobile</FieldLabel>
              <Input id="mobile" name="mobile" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" />
            </Field>
            <Field>
              <FieldLabel htmlFor="leadSource">Lead Source</FieldLabel>
              <Select name="leadSource">
                <SelectTrigger id="leadSource" className="w-full">
                  <SelectValue placeholder="Select lead source">{(v: string) => v || "Select lead source"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="clientType">Client Type</FieldLabel>
              <Select name="clientType">
                <SelectTrigger id="clientType" className="w-full">
                  <SelectValue placeholder="Select client type">{(v: string) => v || "Select client type"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="assignedToId">Assigned RM</FieldLabel>
              <Select name="assignedToId">
                <SelectTrigger id="assignedToId" className="w-full">
                  <SelectValue placeholder="Assign to me">
                    {(value: string) => users.find((u) => u.id === value)?.name ?? "Assign to me"}
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
            <Field>
              <FieldLabel htmlFor="referralSource">Referral Source</FieldLabel>
              <Input id="referralSource" name="referralSource" />
            </Field>
            <Field>
              <FieldLabel htmlFor="dealValue">Deal Value</FieldLabel>
              <Input id="dealValue" name="dealValue" type="number" step="0.01" />
            </Field>
            <Field>
              <FieldLabel htmlFor="notes">Notes</FieldLabel>
              <Textarea id="notes" name="notes" rows={2} />
            </Field>
            <CustomFieldInputs definitions={customFieldDefinitions} />
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
