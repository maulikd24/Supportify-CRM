"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { changeOwnPasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    setPending(true);
    try {
      await changeOwnPasswordAction(formData);
      toast.success("Password updated");
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update password");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} action={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="currentPassword">Current Password</FieldLabel>
          <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
        </Field>
        <Field>
          <FieldLabel htmlFor="newPassword">New Password</FieldLabel>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm New Password</FieldLabel>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
      </FieldGroup>
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? "Updating..." : "Update Password"}
      </Button>
    </form>
  );
}
