"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role, User } from "@/generated/prisma/client";
import { setUserRoleAction, setUserManagerAction, setUserCapacityAction } from "./actions";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserActivationDialog } from "./user-activation-dialog";

const ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER"];

export function UserRowActions({
  user,
  users,
  isSelf,
}: {
  user: User;
  users: Pick<User, "id" | "name" | "role" | "isActive">[];
  isSelf: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  const managers = users.filter((u) => u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"));

  function stageRoleChange(value: string | null) {
    if (!value) return;
    setPendingRole(value === user.role ? null : (value as Role));
  }

  async function handleSaveRole() {
    if (!pendingRole) return;
    setPending(true);
    try {
      await setUserRoleAction(user.id, pendingRole);
      toast.success(`${user.name}'s role updated to ${pendingRole}`);
      setPendingRole(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    } finally {
      setPending(false);
    }
  }

  function handleCancelRole() {
    setPendingRole(null);
  }

  async function handleManagerChange(value: string | null) {
    setPending(true);
    try {
      await setUserManagerAction(user.id, value || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update manager");
    } finally {
      setPending(false);
    }
  }

  async function handleCapacityBlur(value: string) {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) return;
    setPending(true);
    try {
      await setUserCapacityAction(user.id, parsed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update capacity");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Select value={pendingRole ?? user.role} onValueChange={stageRoleChange} disabled={pending || isSelf}>
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue>{(v: string) => v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pendingRole && (
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="default" title="Save role" disabled={pending} onClick={handleSaveRole}>
            <Check className="size-4" />
          </Button>
          <Button size="icon-sm" variant="outline" title="Cancel" disabled={pending} onClick={handleCancelRole}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      <Select value={user.managerId ?? ""} onValueChange={handleManagerChange} disabled={pending || isSelf}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue placeholder="No manager">
            {(v: string) => managers.find((m) => m.id === v)?.name ?? "No manager"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {managers.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        key={user.capacity ?? "empty"}
        type="number"
        min={1}
        className="w-16 h-8 text-xs"
        placeholder="Cap"
        defaultValue={user.capacity ?? ""}
        disabled={pending}
        onBlur={(e) => handleCapacityBlur(e.target.value)}
      />

      <ResetPasswordDialog userId={user.id} userName={user.name} />

      <UserActivationDialog user={user} disabled={isSelf} />
    </div>
  );
}
