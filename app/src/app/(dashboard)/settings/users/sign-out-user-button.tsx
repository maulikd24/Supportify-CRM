"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { callAction } from "@/lib/actions/call-action";
import { signOutUserAction } from "./actions";

/** Ends all of one member's sessions (e.g. a lost laptop). */
export function SignOutUserButton({ userId, userName, disabled }: { userId: string; userName: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!window.confirm(`Sign ${userName} out on all devices? They'll need to sign in again.`)) return;
    setPending(true);
    try {
      await callAction(signOutUserAction)(userId);
      toast.success(`${userName} has been signed out everywhere`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't sign the user out");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="icon-sm" variant="outline" title={`Sign ${userName} out on all devices`} aria-label={`Sign ${userName} out on all devices`} disabled={disabled || pending} onClick={handleClick}>
      <LogOut />
    </Button>
  );
}
