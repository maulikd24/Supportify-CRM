"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils/format";
import { createWebhookAction, deleteWebhookAction, toggleWebhookActiveAction } from "./actions";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import type { WebhookEndpoint, WebhookDelivery } from "@/generated/prisma/client";

type WebhookWithDeliveries = WebhookEndpoint & { deliveries: WebhookDelivery[] };

export function WebhooksPanel({ webhooks }: { webhooks: WebhookWithDeliveries[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleCreate(formData: FormData) {
    setPending(true);
    try {
      const result = await createWebhookAction(formData);
      setNewSecret(result.secret);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create webhook");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWebhookAction(id);
      toast.success("Webhook deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete webhook");
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await toggleWebhookActiveAction(id, isActive);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update webhook");
    }
  }

  function closeDialog(next: boolean) {
    setOpen(next);
    if (!next) setNewSecret(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogTrigger render={<Button size="sm" className="w-fit" />}>New Webhook</DialogTrigger>
        <DialogContent>
          {newSecret ? (
            <>
              <DialogHeader>
                <DialogTitle>Save your signing secret</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Use this to verify the <code className="rounded bg-muted px-1 py-0.5 text-xs">X-Supportify-Signature</code>{" "}
                header. It won&apos;t be shown again.
              </p>
              <Input readOnly value={newSecret} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <DialogFooter className="mt-2">
                <Button onClick={() => closeDialog(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New Webhook</DialogTitle>
              </DialogHeader>
              <form ref={formRef} action={handleCreate}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="webhook-url">Endpoint URL</FieldLabel>
                    <Input id="webhook-url" name="url" type="url" required placeholder="https://example.com/webhooks/supportify" />
                  </Field>
                  <Field>
                    <FieldLabel>Events</FieldLabel>
                    <div className="flex flex-col gap-2">
                      {WEBHOOK_EVENTS.map((event) => (
                        <label key={event} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="events" value={event} className="size-4 rounded border-input" />
                          <span className="font-mono text-xs">{event}</span>
                        </label>
                      ))}
                    </div>
                    <FieldDescription>Choose at least one event to subscribe to.</FieldDescription>
                  </Field>
                </FieldGroup>
                <DialogFooter className="mt-4">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating..." : "Create Webhook"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-4">
        {webhooks.map((webhook) => (
          <div key={webhook.id} className="rounded-md border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-sm">{webhook.url}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(webhook.events as string[]).map((event) => (
                    <Badge key={event} variant="secondary" className="font-mono text-xs">
                      {event}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={webhook.isActive} onCheckedChange={(checked) => handleToggle(webhook.id, checked)} />
                <Button size="sm" variant="outline" onClick={() => handleDelete(webhook.id)}>
                  Delete
                </Button>
              </div>
            </div>
            {webhook.deliveries.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Recent deliveries</p>
                <div className="flex flex-col gap-1">
                  {webhook.deliveries.map((delivery) => (
                    <div key={delivery.id} className="flex items-center gap-2 text-xs">
                      <Badge variant={delivery.success ? "default" : "destructive"} className="w-16 justify-center">
                        {delivery.success ? "OK" : "Failed"}
                      </Badge>
                      <span className="font-mono">{delivery.event}</span>
                      {delivery.statusCode && <span className="text-muted-foreground">{delivery.statusCode}</span>}
                      {delivery.error && <span className="text-muted-foreground">{delivery.error}</span>}
                      <span className="ml-auto text-muted-foreground">{formatDateTime(delivery.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {webhooks.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No webhooks yet.</p>}
      </div>
    </div>
  );
}
