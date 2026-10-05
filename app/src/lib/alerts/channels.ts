import { timingSafeEqual } from "crypto";

import { prisma } from "@/lib/db/prisma";
import { encryptJson } from "@/lib/security/crypto";
import { recordAudit } from "@/lib/audit/record";
import { exchangeSlackCode, slackConfigured, SlackOAuthError } from "@/lib/alerts/slack";
import type { AlertType } from "@/lib/alerts/types";

/** What a newly connected channel receives until an admin changes it. */
export const DEFAULT_ALERT_TYPES: AlertType[] = ["stage_sla_breach"];

export type SlackConnectOutcome = "connected" | "cancelled" | "invalid" | "failed" | "unavailable";

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Finishes "Add to Slack" for an admin: checks the OAuth state against the cookie set when the
 * flow started (so a link from someone else can't attach their channel to this org), exchanges
 * the code for the channel's webhook URL and stores it encrypted.
 */
export async function connectSlackChannel(
  admin: { id: string; organizationId: string },
  input: { code: string | null; state: string | null; expectedState: string | null; error: string | null },
): Promise<SlackConnectOutcome> {
  if (!slackConfigured()) return "unavailable";
  if (!input.state || !input.expectedState || !sameState(input.state, input.expectedState)) return "invalid";
  if (input.error || !input.code) return "cancelled";

  try {
    const { url, channelName } = await exchangeSlackCode(input.code);
    const channel = await prisma.alertChannel.create({
      data: {
        organizationId: admin.organizationId,
        kind: "slack",
        name: channelName,
        encryptedUrl: encryptJson(url),
        alertTypes: DEFAULT_ALERT_TYPES,
        createdById: admin.id,
      },
    });
    await recordAudit({
      organizationId: admin.organizationId,
      userId: admin.id,
      entity: "AlertChannel",
      entityId: channel.id,
      action: "alerts.channel_created",
      newValue: { kind: "slack", name: channelName, alertTypes: DEFAULT_ALERT_TYPES },
    });
    return "connected";
  } catch (error) {
    if (!(error instanceof SlackOAuthError)) console.error("Slack connect failed", error);
    return "failed";
  }
}
