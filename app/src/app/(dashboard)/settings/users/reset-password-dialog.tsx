"use client";

import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { resetUserPasswordAction } from "./actions";

export function ResetPasswordDialog({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setPending(true);
    try {
      await resetUserPasswordAction(userId, newPassword);
      toast.success(`Password reset for ${userName}`);
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset password");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="icon-sm" variant="outline" title="Reset password" />}>
        <KeyRound className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password for {userName}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="newPassword">New Password</FieldLabel>
              <Input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
              <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
