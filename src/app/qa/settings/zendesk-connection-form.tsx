"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { connectZendeskAction, disconnectZendeskAction, retestZendeskConnectionAction } from "./actions";

export function ZendeskConnectionForm({
  connected,
  subdomain,
  email,
  isValid,
}: {
  connected: boolean;
  subdomain?: string;
  email?: string;
  isValid: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await connectZendeskAction(formData);
      toast.success("Zendesk connected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect Zendesk");
    } finally {
      setPending(false);
    }
  }

  async function handleRetest() {
    setPending(true);
    try {
      await retestZendeskConnectionAction();
      toast.success("Connection verified");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setPending(false);
    }
  }

  async function handleDisconnect() {
    setPending(true);
    try {
      await disconnectZendeskAction();
      toast.success("Zendesk disconnected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect");
    } finally {
      setPending(false);
    }
  }

  if (connected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{subdomain}.zendesk.com</span>
          <span className="text-sm text-muted-foreground">({email})</span>
          <Badge variant={isValid ? "default" : "destructive"}>{isValid ? "Connected" : "Needs attention"}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={handleRetest}>
            Test connection
          </Button>
          <Button size="sm" variant="destructive" disabled={pending} onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="subdomain">Subdomain</FieldLabel>
          <Input id="subdomain" name="subdomain" placeholder="yourcompany" required />
          <FieldDescription>The part before .zendesk.com</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="zd-email">Agent email</FieldLabel>
          <Input id="zd-email" name="email" type="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="apiToken">API token</FieldLabel>
          <Input id="apiToken" name="apiToken" type="password" required />
          <FieldDescription>
            Generate one under Zendesk Admin Center &rarr; Apps and integrations &rarr; APIs.
          </FieldDescription>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Connecting..." : "Connect Zendesk"}
        </Button>
      </FieldGroup>
    </form>
  );
}
