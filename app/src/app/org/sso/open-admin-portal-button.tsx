"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { openSsoAdminPortalAction } from "./actions";
import { callAction } from "@/lib/actions/call-action";

export function OpenAdminPortalButton() {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await callAction(openSsoAdminPortalAction)();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open the setup portal");
      setPending(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={pending}>
      {pending ? "Opening..." : "Configure SSO Connection"}
    </Button>
  );
}
