"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createCustomFieldAction } from "./actions";

const FIELD_TYPES = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date" },
  { value: "BOOLEAN", label: "Yes/No" },
  { value: "SELECT", label: "Dropdown" },
];

export function NewCustomFieldDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldType, setFieldType] = useState("TEXT");
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createCustomFieldAction(formData);
      toast.success("Field added");
      setOpen(false);
      formRef.current?.reset();
      setFieldType("TEXT");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add field");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Field
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Custom Field</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="label">Label</FieldLabel>
              <Input id="label" name="label" required placeholder="Industry" />
            </Field>
            <Field>
              <FieldLabel htmlFor="fieldType">Type</FieldLabel>
              <Select name="fieldType" value={fieldType} onValueChange={(v) => v && setFieldType(v)}>
                <SelectTrigger id="fieldType" className="w-full">
                  <SelectValue>{(v: string) => FIELD_TYPES.find((t) => t.value === v)?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {fieldType === "SELECT" && (
              <Field>
                <FieldLabel htmlFor="options">Options</FieldLabel>
                <Input id="options" name="options" placeholder="Small, Medium, Large" />
                <FieldDescription>Comma-separated list of choices.</FieldDescription>
              </Field>
            )}
            <Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="required" value="true" />
                Required
              </label>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add Field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
