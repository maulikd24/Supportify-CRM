import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { getMessagingAdapter, messagingProviderKeyFor } from "@/lib/messaging/registry";

export function substitute(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

/** Unified send used by both the manual "send message" UI action and journey send_message action nodes. */
export async function sendMessage(params: {
  clientId: string;
  channel: "whatsapp" | "sms";
  templateId?: string | null;
  variables?: Record<string, string>;
}) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: params.clientId } });
  if (!client.mobile) throw new Error("Client has no mobile number");

  const variables = params.variables ?? {};
  const template = params.templateId
    ? await prisma.messageTemplate.findUnique({
        where: { id: params.templateId, organizationId: client.organizationId },
      })
    : null;

  if (params.templateId && template?.approved === false) {
    throw new Error("Cannot send an unapproved template");
  }

  const body = template ? substitute(template.body, variables) : (variables.body ?? "");
  const provider = messagingProviderKeyFor(params.channel);

  const message = await prisma.message.create({
    data: {
      organizationId: client.organizationId,
      clientId: client.id,
      channel: params.channel,
      provider,
      direction: "OUTBOUND",
      templateId: template?.id,
      body,
      status: "QUEUED",
    },
  });

  try {
    const adapter = await getMessagingAdapter(params.channel, client.organizationId);
    const result = await adapter.sendMessage({
      to: client.mobile,
      body,
      templateExternalId: template?.externalId,
      variables,
    });

    await prisma.message.update({
      where: { id: message.id },
      data: { status: result.status, externalId: result.externalId },
    });

    await logActivity({
      clientId: client.id,
      type: "MESSAGE",
      payload: { direction: "OUTBOUND", channel: params.channel, body, status: result.status },
    });

    return { ...message, status: result.status, externalId: result.externalId };
  } catch (error) {
    await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED" } });
    throw error;
  }
}
