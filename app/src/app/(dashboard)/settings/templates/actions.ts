"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireCrmRole } from "@/lib/auth/require-role";
import { withUserErrors } from "@/lib/actions/user-error";

const templateSchema = z.object({
  channel: z.enum(["whatsapp", "sms"]),
  name: z.string().min(1),
  body: z.string().min(1),
  externalId: z.string().optional().or(z.literal("")),
});

export const createTemplateAction = withUserErrors(async function createTemplateAction(formData: FormData) {
  const session = await requireCrmRole(["ADMIN"]);

  const parsed = templateSchema.parse({
    channel: formData.get("channel"),
    name: formData.get("name"),
    body: formData.get("body"),
    externalId: formData.get("externalId"),
  });

  const variableMatches = [...parsed.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  await prisma.messageTemplate.create({
    data: {
      organizationId: session.user.organizationId,
      channel: parsed.channel,
      provider: parsed.channel === "whatsapp" ? "whatsapp_meta" : "sms_exotel",
      name: parsed.name,
      body: parsed.body,
      externalId: parsed.externalId || null,
      variables: [...new Set(variableMatches)],
      approved: false,
    },
  });

  revalidatePath("/settings/templates");
});

export const setTemplateApprovedAction = withUserErrors(async function setTemplateApprovedAction(templateId: string, approved: boolean) {
  const session = await requireCrmRole(["ADMIN"]);

  await prisma.messageTemplate.update({
    where: { id: templateId, organizationId: session.user.organizationId },
    data: { approved },
  });

  revalidatePath("/settings/templates");
});

export const deleteTemplateAction = withUserErrors(async function deleteTemplateAction(templateId: string) {
  const session = await requireCrmRole(["ADMIN"]);

  await prisma.messageTemplate.delete({ where: { id: templateId, organizationId: session.user.organizationId } });

  revalidatePath("/settings/templates");
});
