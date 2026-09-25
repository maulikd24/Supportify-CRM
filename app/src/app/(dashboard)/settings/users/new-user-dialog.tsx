"use client";

import { useRef, useState } from "react";
import { Plus, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { User } from "@/generated/prisma/client";
import { createUserAction } from "./actions";

const ROLES = ["ADMIN", "MANAGER", "RM", "DEALER"] as const;

export function NewUserDialog({ users }: { users: Pick<User, "id" | "name" | "role" | "isActive">[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const managers = users.filter((u) => u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"));

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const result = await createUserAction(formData);
      setTempPassword(result.tempPassword);
      toast.success("User created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create user");
    } finally {
      setPending(false);
    }
  }

  function handleClose(next: boolean) {
    setOpen(next);
    if (!next) {
      setTempPassword(null);
      setCopied(false);
      formRef.current?.reset();
    }
  }

  async function handleCopy() {
    if (!tempPassword) return;
    await navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    toast.success("Copied to clipboard");
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New User
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
        </DialogHeader>

        {tempPassword ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              User created. Share this temporary password with them — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono">{tempPassword}</code>
              <Button size="icon-sm" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form ref={formRef} action={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="user-name">Name</FieldLabel>
                <Input id="user-name" name="name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-email">Email</FieldLabel>
                <Input id="user-email" name="email" type="email" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-role">Role</FieldLabel>
                <Select name="role" defaultValue="RM">
                  <SelectTrigger id="user-role" className="w-full">
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
              </Field>
              <Field>
                <FieldLabel htmlFor="user-manager">Manager (optional)</FieldLabel>
                <Select name="managerId">
                  <SelectTrigger id="user-manager" className="w-full">
                    <SelectValue placeholder="None">
                      {(v: string) => managers.find((m) => m.id === v)?.name ?? "None"}
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
                <FieldDescription>Used to scope which leads a Manager can see.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="user-capacity">Capacity (optional)</FieldLabel>
                <Input id="user-capacity" name="capacity" type="number" min={1} placeholder="Max active clients" />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
