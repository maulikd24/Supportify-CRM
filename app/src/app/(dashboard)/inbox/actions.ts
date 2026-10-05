"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireCrmUser } from "@/lib/auth/require-role";
import { sendMessage } from "@/lib/messaging/send";
import { getThread, markConversationRead } from "@/lib/inbox/inbox";
import { UserError, withUserErrors } from "@/lib/actions/user-error";

const replySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), channel: z.enum(["whatsapp", "sms"]), text: z.string().trim().min(1, "Write a message").max(4096) }),
  z.object({
    kind: z.literal("template"),
    channel: z.enum(["whatsapp", "sms"]),
    templateId: z.string().min(1, "Choose a template"),
    variables: z.record(z.string(), z.string()).default({}),
  }),
]);

/**
 * Replies in a conversation. WhatsApp free text is only accepted inside the 24-hour window
 * opened by the client's last message (Meta rejects it otherwise); outside it, only an
 * approved template for that channel can be sent.
 */
export const sendInboxReplyAction = withUserErrors(async function sendInboxReplyAction(clientId: string, input: z.input<typeof replySchema>) {
  const session = await requireCrmUser();
  const reply = replySchema.parse(input);
  const thread = await getThread(session.user, clientId); // access check

  if (reply.kind === "text") {
    if (reply.channel === "whatsapp" && !thread.whatsappWindowEndsAt) {
      throw new UserError("The 24-hour WhatsApp window has closed. Send an approved template instead.");
    }
    await sendMessage({ clientId, channel: reply.channel, variables: { body: reply.text } });
  } else {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: reply.templateId, organizationId: session.user.organizationId, channel: reply.channel, approved: true },
      select: { id: true },
    });
    if (!template) throw new UserError("Template not found or not approved for this channel.");
    await sendMessage({ clientId, channel: reply.channel, templateId: template.id, variables: reply.variables });
  }

  // Replying means the conversation has been read.
  await markConversationRead(session.user, clientId);
  revalidatePath("/inbox");
  revalidatePath(`/clients/${clientId}`);
});

export const markConversationReadAction = withUserErrors(async function markConversationReadAction(clientId: string) {
  const session = await requireCrmUser();
  const marked = await markConversationRead(session.user, clientId);
  if (marked > 0) revalidatePath("/inbox");
});
