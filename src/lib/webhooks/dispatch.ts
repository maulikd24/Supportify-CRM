import { createHmac } from "crypto";

import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import type { WebhookEvent } from "@/lib/webhooks/events";

export { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
export type { WebhookEvent } from "@/lib/webhooks/events";

const DELIVERY_TIMEOUT_MS = 8000;

/**
 * Fans an event out to every active endpoint the org has subscribed to it.
 * Fire-and-forget from the caller's perspective — a slow or failing customer
 * endpoint must never delay or break the action that triggered the event, so
 * this never throws; every outcome (including a network failure) is recorded
 * as a WebhookDelivery row instead.
 */
export async function dispatchWebhookEvent(
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { organizationId, isActive: true } });
  const subscribed = endpoints.filter((e) => Array.isArray(e.events) && (e.events as string[]).includes(event));
  if (subscribed.length === 0) return;

  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  await Promise.all(
    subscribed.map(async (endpoint) => {
      const secret = decryptJson<string>(endpoint.encryptedSecret);
      const signature = createHmac("sha256", secret).update(payload).digest("hex");

      let statusCode: number | null = null;
      let success = false;
      let error: string | null = null;

      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Supportify-Signature": `sha256=${signature}` },
          body: payload,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        statusCode = response.status;
        success = response.ok;
        if (!success) error = `Endpoint responded with ${response.status}`;
      } catch (err) {
        error = err instanceof Error ? err.message : "Request failed";
      }

      await prisma.webhookDelivery.create({
        data: { webhookEndpointId: endpoint.id, event, statusCode, success, error },
      });
    }),
  );
}
