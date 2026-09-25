"use client";

import { useState } from "react";
import { UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { User } from "@/generated/prisma/client";
import { setUserActiveAction } from "./actions";

export function UserActivationDialog({
  user,
  disabled,
}: {
  user: Pick<User, "id" | "name" | "isActive">;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await setUserActiveAction(user.id, !user.isActive);
      toast.success(user.isActive ? `${user.name} removed` : `${user.name} reactivated`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user status");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="icon-sm"
            variant={user.isActive ? "destructive" : "outline"}
            title={user.isActive ? "Remove user" : "Reactivate user"}
            disabled={disabled}
          />
        }
      >
        {user.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {user.isActive ? `Remove ${user.name}?` : `Reactivate ${user.name}?`}
          </DialogTitle>
          <DialogDescription>
            {user.isActive
              ? "This immediately blocks their sign-in. Their existing client assignments, tasks, and history are preserved — nothing is deleted. You can reactivate this account at any time."
              : "They will be able to sign in again immediately."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={user.isActive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Saving..." : user.isActive ? "Confirm removal" : "Reactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
