"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { decryptJson } from "@/lib/security/crypto";
import { ZendeskClient, type ZendeskCredentials } from "@/lib/qa/zendesk-client";
import { analyzeDsat, parseManualConversation, type ConversationTurn } from "@/lib/qa/assessor";
import type { Prisma } from "@/generated/prisma/client";

const dsatSchema = z.object({
  inputMode: z.enum(["manual", "zendesk"]).default("manual"),
  ticketId: z.string().optional().default(""),
  manualSubject: z.string().optional().default(""),
  agentName: z.string().optional().default(""),
  customerName: z.string().optional().default(""),
  context: z.string().optional().default(""),
  manualConversation: z.string().optional().default(""),
});

export async function submitDsatAction(formData: FormData) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const parsed = dsatSchema.parse({
    inputMode: formData.get("inputMode") || "manual",
    ticketId: formData.get("ticketId") || "",
    manualSubject: formData.get("manualSubject") || "",
    agentName: formData.get("agentName") || "",
    customerName: formData.get("customerName") || "",
    context: formData.get("context") || "",
    manualConversation: formData.get("manualConversation") || "",
  });

  let conversation: ConversationTurn[] = [];
  let subject = parsed.manualSubject.trim();
  let customerName = parsed.customerName.trim();
  const ticketId = parsed.ticketId.trim();

  if (parsed.inputMode === "zendesk" && ticketId) {
    const connection = await prisma.zendeskConnection.findUnique({ where: { organizationId } });
    if (!connection) throw new Error("Connect Zendesk in Settings before analysing a live ticket");

    const credentials = decryptJson<ZendeskCredentials>(connection.encryptedToken);
    const zendesk = new ZendeskClient(credentials);
    const ticketData = await zendesk.getTicketWithConversation(ticketId);
    conversation = ticketData.conversation;
    const ticket = ticketData.ticket as { subject?: string };
    subject = subject || ticket.subject || "";
  } else {
    const raw = parsed.manualConversation.trim();
    if (!raw) throw new Error("Please paste a conversation.");
    conversation = parseManualConversation(raw);
    if (conversation.length === 0) {
      throw new Error("Could not parse conversation — please use [CUSTOMER]: / [AGENT]: labels.");
    }
  }

  const result = await analyzeDsat({
    conversation,
    subject,
    customerName,
    context: parsed.context.trim(),
  });

  const analysis = await prisma.dsatAnalysis.create({
    data: {
      organizationId,
      ticketId: ticketId || undefined,
      ticketSubject: subject || undefined,
      agentName: parsed.agentName.trim() || undefined,
      customerName: customerName || undefined,
      context: parsed.context.trim() || undefined,
      rawConversation: JSON.stringify(conversation),
      whatWentWrong: result.what_went_wrong,
      rootCauses: result.root_causes as Prisma.InputJsonValue,
      customerImpact: result.customer_impact,
      csatRecoveryRecommendations: result.csat_recovery_recommendations as Prisma.InputJsonValue,
      followUpResponse: result.follow_up_response as Prisma.InputJsonValue,
      preventionTips: result.prevention_tips as Prisma.InputJsonValue,
      recoveryProbability: result.recovery_probability,
      recoveryRationale: result.recovery_rationale,
    },
  });

  revalidatePath("/qa/dsat");
  return { analysisId: analysis.id };
}

export async function saveDsatCommentAction(analysisId: string, comment: string) {
  const session = await requireOrg();

  await prisma.dsatAnalysis.update({
    where: { id: analysisId, organizationId: session.user.organizationId },
    data: { improvementsComment: comment.trim() || null },
  });

  revalidatePath(`/qa/dsat/${analysisId}`);
}
