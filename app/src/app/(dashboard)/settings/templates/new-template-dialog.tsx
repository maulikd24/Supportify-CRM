"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
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
import { createTemplateAction } from "./actions";

export function NewTemplateDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createTemplateAction(formData);
      toast.success("Template created");
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create template");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Template
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Message Template</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="template-name">Name</FieldLabel>
              <Input id="template-name" name="name" required placeholder="Welcome message" />
            </Field>
            <Field>
              <FieldLabel htmlFor="template-channel">Channel</FieldLabel>
              <Select name="channel" defaultValue="whatsapp">
                <SelectTrigger id="template-channel" className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="template-body">Body</FieldLabel>
              <Textarea
                id="template-body"
                name="body"
                required
                rows={4}
                placeholder="Hi {{name}}, thanks for your interest..."
              />
              <FieldDescription>Use {"{{variable}}"} placeholders for personalization.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="template-external-id">Provider Template ID (optional)</FieldLabel>
              <Input
                id="template-external-id"
                name="externalId"
                placeholder="Registered template name with your provider"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
