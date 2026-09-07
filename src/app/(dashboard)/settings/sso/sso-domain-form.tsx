"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { saveSsoDomainAction } from "./actions";

export function SsoDomainForm({ currentDomain }: { currentDomain: string | null }) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await saveSsoDomainAction(formData);
      toast.success("SSO domain saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save domain");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="domain">Domain</FieldLabel>
          <Input id="domain" name="domain" placeholder="acme.com" defaultValue={currentDomain ?? ""} required />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
