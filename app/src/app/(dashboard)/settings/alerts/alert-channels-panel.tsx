"use client";

import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { formatDateTime } from "@/lib/utils/format";
import { ALERT_TYPE_META, ALERT_TYPES, type AlertType } from "@/lib/alerts/types";
import {
  addTeamsChannelAction,
  deleteAlertChannelAction,
  sendTestAlertAction,
  setAlertChannelActiveAction,
  updateAlertTypesAction,
} from "./actions";

type Channel = {
  id: string;
  kind: string;
  name: string;
  alertTypes: string[];
  isActive: boolean;
  lastError: string | null;
  deliveries: { id: string; alertType: string; alertCount: number; success: boolean; statusCode: number | null; error: string | null; createdAt: Date }[];
};

const KIND_LABEL: Record<string, string> = { slack: "Slack", teams: "Teams" };

function deliveryLabel(alertType: string, count: number): string {
  if (alertType === "test") return "Test message";
  const label = ALERT_TYPE_META[alertType as AlertType]?.label ?? alertType;
  return count > 1 ? `${label} (summary of ${count})` : label;
}

export function AlertChannelsPanel({ channels, slackAvailable }: { channels: Channel[]; slackAvailable: boolean }) {
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    }
  }

  // onSubmit rather than <form action>: React resets an action form even when the action
  // failed, which would wipe the admin's input along with the error.
  async function handleAddTeams(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await callAction(addTeamsChannelAction)(new FormData(event.currentTarget));
      toast.success("Teams channel added");
      formRef.current?.reset();
      setTeamsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the channel");
    } finally {
      setPending(false);
    }
  }

  function toggleType(channel: Channel, type: AlertType, checked: boolean) {
    const next = checked ? [...channel.alertTypes, type] : channel.alertTypes.filter((t) => t !== type);
    void run(() => callAction(updateAlertTypesAction)(channel.id, next));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {slackAvailable ? (
          // A plain link: the OAuth flow is a full-page redirect to Slack and back.
          <Button size="sm" render={<a href="/api/integrations/slack/install" />}>
            Add to Slack
          </Button>
        ) : (
          <Button size="sm" disabled title="Slack isn't set up on this Supportify installation yet">
            Add to Slack
          </Button>
        )}

        <Dialog open={teamsOpen} onOpenChange={setTeamsOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>Add Teams channel</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a Microsoft Teams channel</DialogTitle>
            </DialogHeader>
            <form ref={formRef} onSubmit={handleAddTeams}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="teams-name">Name</FieldLabel>
                  <Input id="teams-name" name="name" required maxLength={80} placeholder="Ops managers" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="teams-url">Workflow webhook URL</FieldLabel>
                  <Input id="teams-url" name="url" type="url" required placeholder="https://…" />
                  <FieldDescription>
                    In the Teams channel, open Workflows and choose &quot;Post to a channel when a webhook request is
                    received&quot;, then paste the URL it gives you.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter className="mt-4">
                <Button type="submit" disabled={pending}>
                  {pending ? "Adding..." : "Add channel"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {channels.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">No channels yet. Add a Slack or Teams channel to start.</p>
      )}

      {channels.map((channel) => (
        <div key={channel.id} className="rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Badge variant="secondary">{KIND_LABEL[channel.kind] ?? channel.kind}</Badge>
                <span className="truncate">{channel.name}</span>
              </p>
              {!channel.isActive && (
                <p className="mt-1 text-xs text-destructive">
                  Off{channel.lastError ? `: last error "${channel.lastError}"` : ""}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                aria-label={`Send alerts to ${channel.name}`}
                checked={channel.isActive}
                onCheckedChange={(checked) => run(() => callAction(setAlertChannelActiveAction)(channel.id, checked))}
              />
              <Button size="sm" variant="outline" onClick={() => run(() => callAction(sendTestAlertAction)(channel.id), "Test message sent")}>
                Send test
              </Button>
              <Button size="sm" variant="outline" onClick={() => run(() => callAction(deleteAlertChannelAction)(channel.id), "Channel removed")}>
                Remove
              </Button>
            </div>
          </div>

          <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Alerts sent to {channel.name}</legend>
            {ALERT_TYPES.map((type) => (
              <label key={type} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-input"
                  checked={channel.alertTypes.includes(type)}
                  onChange={(e) => toggleType(channel, type, e.target.checked)}
                />
                <span>
                  {ALERT_TYPE_META[type].label}
                  <span className="block text-xs text-muted-foreground">{ALERT_TYPE_META[type].description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {channel.deliveries.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Recent deliveries</p>
              <div className="flex flex-col gap-1">
                {channel.deliveries.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={d.success ? "default" : "destructive"} className="w-16 justify-center">
                      {d.success ? "OK" : "Failed"}
                    </Badge>
                    <span>{deliveryLabel(d.alertType, d.alertCount)}</span>
                    {d.error && <span className="text-muted-foreground">{d.error}</span>}
                    <span className="ml-auto text-muted-foreground">{formatDateTime(d.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
