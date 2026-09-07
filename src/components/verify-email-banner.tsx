"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resendVerificationEmailAction } from "@/lib/auth/resend-verification";

export function VerifyEmailBanner() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleResend() {
    setPending(true);
    try {
      await resendVerificationEmailAction();
      setSent(true);
      toast.success("Verification email sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send email");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <span>Verify your email address to unlock billing and subscriptions.</span>
      <Button size="xs" variant="outline" disabled={pending || sent} onClick={handleResend}>
        {sent ? "Sent" : pending ? "Sending..." : "Resend email"}
      </Button>
    </div>
  );
}
