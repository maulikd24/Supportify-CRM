import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { postJsonToPublicUrl } from "@/lib/security/outbound";
import { DIGEST_THRESHOLD, renderMessage } from "@/lib/alerts/format";
import type { Alert, AlertChannelKind, AlertType } from "@/lib/alerts/types";

const DELIVERY_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2;
/** After this many failed deliveries in a row a channel is switched off and admins are told. */
export const MAX_CONSECUTIVE_FAILURES = 3;

function retryDelayMs(): number {
  return Number(process.env.ALERT_RETRY_DELAY_MS ?? 1000);
}

type Channel = { id: string; organizationId: string; kind: string; name: string; encryptedUrl: string; alertTypes: unknown };

/**
 * Posts alerts to every active Slack/Teams channel in the alert's org that subscribed to its type.
 * Called by the background sweeps after their once-per-episode claims, so it never decides
 * *whether* to alert, only where. Up to DIGEST_THRESHOLD alerts of one type go out one message
 * each; more (a backlog, or a channel just switched on) become one digest message so a burst
 * doesn't trip Slack's rate limit. Never throws: every outcome is an AlertDelivery row.
 */
export async function routeAlerts(alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return;
  const orgIds = [...new Set(alerts.map((a) => a.organizationId))];
  try {
    const channels = await prisma.alertChannel.findMany({ where: { organizationId: { in: orgIds }, isActive: true } });
    await Promise.all(
      channels.map(async (channel) => {
        const subscribed = new Set(Array.isArray(channel.alertTypes) ? (channel.alertTypes as string[]) : []);
        const byType = new Map<AlertType, Alert[]>();
        for (const alert of alerts) {
          if (alert.organizationId !== channel.organizationId || !subscribed.has(alert.type)) continue;
          byType.set(alert.type, [...(byType.get(alert.type) ?? []), alert]);
        }
        for (const [type, batch] of byType) {
          const messages = batch.length > DIGEST_THRESHOLD ? [batch] : batch.map((a) => [a]);
          for (const group of messages) {
            // A channel switched off by earlier failures in this run gets nothing more.
            const body = renderMessage(channel.kind as AlertChannelKind, type, group);
            if (!(await deliver(channel, { alertType: type, alertCount: group.length, body }))) {
              const stillActive = await prisma.alertChannel.count({ where: { id: channel.id, isActive: true } });
              if (!stillActive) return;
            }
          }
        }
      }),
    );
  } catch (error) {
    console.error("Failed to route team alerts", error);
  }
}

/**
 * Sends one message to one channel (retrying once) and records it. A success clears the failure
 * streak; a failure extends it unless `trackFailures` is off (a test message from settings).
 */
export async function deliver(
  channel: Channel,
  message: { alertType: string; alertCount: number; body: Record<string, unknown> },
  { trackFailures = true } = {},
): Promise<boolean> {
  const body = JSON.stringify(message.body);
  let statusCode: number | null = null;
  let error: string | null = null;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const url = decryptJson<string>(channel.encryptedUrl);
      // https + public addresses only, no redirects: the URL is customer-supplied for Teams.
      statusCode = (await postJsonToPublicUrl(url, body, {}, DELIVERY_TIMEOUT_MS)).status;
      error = statusCode >= 200 && statusCode < 300 ? null : `Channel responded with ${statusCode}`;
    } catch (err) {
      statusCode = null;
      error = err instanceof Error ? err.message : "Request failed";
    }
    // Retry only what might succeed on a second try: network errors, 429 and 5xx.
    const retryable = error !== null && (statusCode === null || statusCode === 429 || statusCode >= 500);
    if (!retryable || attempts >= MAX_ATTEMPTS) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs()));
  }

  const success = error === null;
  await prisma.alertDelivery.create({
    data: { alertChannelId: channel.id, alertType: message.alertType, alertCount: message.alertCount, success, attempts, statusCode, error },
  });

  if (success) {
    await prisma.alertChannel.updateMany({ where: { id: channel.id, consecutiveFailures: { gt: 0 } }, data: { consecutiveFailures: 0, lastError: null } });
    return true;
  }
  if (!trackFailures) return false;

  const { consecutiveFailures } = await prisma.alertChannel.update({
    where: { id: channel.id },
    data: { consecutiveFailures: { increment: 1 }, lastError: error },
    select: { consecutiveFailures: true },
  });
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) await disableChannel(channel, error ?? "Delivery failed");
  return false;
}

/** Switches a failing channel off and tells the org's admins in-app — exactly once, even under races. */
async function disableChannel(channel: Channel, reason: string) {
  const { count } = await prisma.alertChannel.updateMany({ where: { id: channel.id, isActive: true }, data: { isActive: false } });
  if (count === 0) return;
  const admins = await prisma.user.findMany({
    where: { organizationId: channel.organizationId, role: "ADMIN", isActive: true, orgRole: { not: "AGENT" } },
    select: { id: true },
  });
  await prisma.notification.createMany({
    data: admins.map((a) => ({
      organizationId: channel.organizationId,
      userId: a.id,
      type: "alert_channel_disabled",
      payload: { channelId: channel.id, channelName: channel.name, kind: channel.kind, reason },
    })),
  });
}
