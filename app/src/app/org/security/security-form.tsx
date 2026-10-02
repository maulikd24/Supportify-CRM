"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { saveSecurityPoliciesAction, signOutAllDevicesAction } from "./actions";

const DEFAULT = "default";

export function SecurityForm({
  initial,
  sessionOptions,
  ssoConfigured,
  eligible,
}: {
  initial: { require2fa: boolean; requireSso: boolean; sessionMaxHours: number | null };
  sessionOptions: { hours: number; label: string }[];
  ssoConfigured: boolean;
  eligible: boolean;
}) {
  const [require2fa, setRequire2fa] = useState(initial.require2fa);
  const [requireSso, setRequireSso] = useState(initial.requireSso);
  const [sessionMaxHours, setSessionMaxHours] = useState<number | null>(initial.sessionMaxHours);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      await callAction(saveSecurityPoliciesAction)({ require2fa, requireSso, sessionMaxHours });
      toast.success("Security policies saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save policies");
    } finally {
      setPending(false);
    }
  }

  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <Switch id="req-2fa" checked={require2fa} onCheckedChange={setRequire2fa} disabled={!eligible && !require2fa} />
        <div>
          <FieldLabel htmlFor="req-2fa">Require two-factor authentication</FieldLabel>
          <FieldDescription>Members without 2FA are asked to set it up before they can use Supportify. SSO sign-ins are exempt.</FieldDescription>
        </div>
      </Field>

      <Field orientation="horizontal">
        <Switch
          id="req-sso"
          checked={requireSso}
          onCheckedChange={setRequireSso}
          disabled={(!eligible || !ssoConfigured) && !requireSso}
        />
        <div>
          <FieldLabel htmlFor="req-sso">Require single sign-on</FieldLabel>
          <FieldDescription>
            {ssoConfigured
              ? "Members must sign in through your identity provider. The owner can still use a password, so a broken SSO setup can't lock you out."
              : "Set up single sign-on first to turn this on."}
          </FieldDescription>
        </div>
      </Field>

      <Field>
        <FieldLabel htmlFor="session-limit">Session length</FieldLabel>
        <Select
          value={sessionMaxHours === null ? DEFAULT : String(sessionMaxHours)}
          onValueChange={(v) => setSessionMaxHours(v === DEFAULT ? null : Number(v))}
          disabled={!eligible && sessionMaxHours === null}
        >
          <SelectTrigger id="session-limit" className="w-60">
            <SelectValue>
              {(v: string) => (v === DEFAULT ? "Default (30 days)" : sessionOptions.find((o) => String(o.hours) === v)?.label ?? v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Default (30 days)</SelectItem>
            {sessionOptions.map((o) => (
              <SelectItem key={o.hours} value={String(o.hours)}>
                Sign out after {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Members are signed out this long after they sign in, and have to sign in again.</FieldDescription>
      </Field>

      <div>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save policies"}
        </Button>
      </div>
    </FieldGroup>
  );
}

export function SignOutAllButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function confirm() {
    setPending(true);
    try {
      await callAction(signOutAllDevicesAction)();
      // Our own session was ended too; reload into the sign-in page.
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't sign everyone out");
      setPending(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" />}>Sign out all devices</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign everyone out?</DialogTitle>
          <DialogDescription>
            Every member of your organization, including you, is signed out on all devices and must sign in again. Use this
            after a lost laptop or a suspected compromise.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Signing out..." : "Sign everyone out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
