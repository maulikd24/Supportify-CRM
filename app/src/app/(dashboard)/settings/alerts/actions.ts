"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { encryptJson } from "@/lib/security/crypto";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/security/outbound";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { DEFAULT_ALERT_TYPES } from "@/lib/alerts/channels";
import { renderTestMessage } from "@/lib/alerts/format";
import { deliver } from "@/lib/alerts/route";
import { ALERT_TYPES, type AlertChannelKind } from "@/lib/alerts/types";

const PATH = "/settings/alerts";

/** The admin's own org's channel, or a "not found" error (never another org's). */
async function findChannel(organizationId: string, channelId: string) {
  const channel = await prisma.alertChannel.findFirst({ where: { id: channelId, organizationId } });
  if (!channel) throw new UserError("Channel not found");
  return channel;
}

const teamsSchema = z.object({
  name: z.string().trim().min(1, "Give the channel a name").max(80),
  url: z.string().trim().url("Enter a valid URL"),
});

/** Teams: an admin pastes the URL of a "post to a channel when a webhook request is received" workflow. */
export const addTeamsChannelAction = withUserErrors(async function addTeamsChannelAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const parsed = teamsSchema.parse({ name: formData.get("name"), url: formData.get("url") });

  // Same rule as outgoing webhooks: https and public addresses only (deliveries re-check).
  try {
    await assertPublicHttpsUrl(parsed.url);
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw new UserError(error.message);
    throw error;
  }

  const channel = await prisma.alertChannel.create({
    data: {
      organizationId: session.user.organizationId,
      kind: "teams",
      name: parsed.name,
      encryptedUrl: encryptJson(parsed.url),
      alertTypes: DEFAULT_ALERT_TYPES,
      createdById: session.user.id,
    },
  });
  await recordAudit({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    entity: "AlertChannel",
    entityId: channel.id,
    action: "alerts.channel_created",
    newValue: { kind: "teams", name: parsed.name, alertTypes: DEFAULT_ALERT_TYPES },
  });
  revalidatePath(PATH);
});

export const updateAlertTypesAction = withUserErrors(async function updateAlertTypesAction(channelId: string, alertTypes: string[]) {
  const session = await requireRole(["ADMIN"]);
  const types = z.array(z.enum(ALERT_TYPES)).parse([...new Set(alertTypes)]);
  const channel = await findChannel(session.user.organizationId, channelId);

  await prisma.alertChannel.update({ where: { id: channel.id }, data: { alertTypes: types } });
  await recordAudit({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    entity: "AlertChannel",
    entityId: channel.id,
    action: "alerts.channel_updated",
    oldValue: { alertTypes: channel.alertTypes as string[] },
    newValue: { alertTypes: types },
  });
  revalidatePath(PATH);
});

/** Turning a channel back on also clears the failure streak that may have switched it off. */
export const setAlertChannelActiveAction = withUserErrors(async function setAlertChannelActiveAction(channelId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN"]);
  const channel = await findChannel(session.user.organizationId, channelId);

  await prisma.alertChannel.update({
    where: { id: channel.id },
    data: isActive ? { isActive, consecutiveFailures: 0, lastError: null } : { isActive },
  });
  await recordAudit({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    entity: "AlertChannel",
    entityId: channel.id,
    action: "alerts.channel_updated",
    oldValue: { isActive: channel.isActive },
    newValue: { isActive },
  });
  revalidatePath(PATH);
});

export const deleteAlertChannelAction = withUserErrors(async function deleteAlertChannelAction(channelId: string) {
  const session = await requireRole(["ADMIN"]);
  const channel = await findChannel(session.user.organizationId, channelId);

  await prisma.alertChannel.delete({ where: { id: channel.id } });
  await recordAudit({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    entity: "AlertChannel",
    entityId: channel.id,
    action: "alerts.channel_deleted",
    oldValue: { kind: channel.kind, name: channel.name },
  });
  revalidatePath(PATH);
});

export const sendTestAlertAction = withUserErrors(async function sendTestAlertAction(channelId: string) {
  const session = await requireRole(["ADMIN"]);
  const channel = await findChannel(session.user.organizationId, channelId);

  const ok = await deliver(
    channel,
    { alertType: "test", alertCount: 1, body: renderTestMessage(channel.kind as AlertChannelKind) },
    { trackFailures: false },
  );
  revalidatePath(PATH);
  if (!ok) throw new UserError("The test message couldn't be delivered. Check the channel's recent deliveries below.");
});
