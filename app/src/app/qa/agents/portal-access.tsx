"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { callAction } from "@/lib/actions/call-action";
import { inviteAgentAction, resendAgentInviteAction, setAgentActiveAction } from "./actions";

export function InviteAgentDialog({
  defaults,
  trigger,
}: {
  defaults?: { name?: string; helpdeskEmail?: string };
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaults?.name ?? "");
  const [email, setEmail] = useState(defaults?.helpdeskEmail ?? "");
  const [helpdeskEmail, setHelpdeskEmail] = useState(defaults?.helpdeskEmail ?? "");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const { emailed } = await callAction(inviteAgentAction)({ name, email, helpdeskEmail: helpdeskEmail || null });
      if (emailed) toast.success(`Invite sent to ${email}`);
      else toast.warning(`${name} was added, but the invite email couldn't be sent. Use "Resend invite" to try again.`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't invite the agent");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to the agent portal</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="agent-name">Name</FieldLabel>
            <Input id="agent-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-email">Login email</FieldLabel>
            <Input id="agent-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FieldDescription>We&apos;ll email a link to set their password.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-helpdesk">Helpdesk email</FieldLabel>
            <Input id="agent-helpdesk" type="email" value={helpdeskEmail} placeholder="Same as login email" onChange={(e) => setHelpdeskEmail(e.target.value)} />
            <FieldDescription>Their reviews are matched by this email. Leave empty if it&apos;s the same as the login email.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Inviting..." : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PortalAccessMenu({ userId, name, isActive }: { userId: string; name: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      const result = (await fn()) as { emailed?: boolean } | undefined;
      if (result?.emailed === false) toast.warning("The invite email couldn't be sent. Try again shortly.");
      else toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-1">
      <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Portal access" : "Access removed"}</Badge>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Portal access for ${name}`} disabled={pending} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isActive ? (
            <>
              <DropdownMenuItem onClick={() => run(() => callAction(resendAgentInviteAction)(userId), `Invite resent to ${name}`)}>Resend invite</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => confirm(`Remove ${name}'s portal access? They're signed out right away.`) && run(() => callAction(setAgentActiveAction)(userId, false), "Portal access removed")}
              >
                Remove access
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={() => run(() => callAction(setAgentActiveAction)(userId, true), "Portal access restored")}>Restore access</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
