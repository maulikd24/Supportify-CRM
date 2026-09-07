"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";

const updateStageSchema = z.object({
  name: z.string().min(1),
  slaHours: z.coerce.number().int().min(0),
  isActive: z.boolean(),
  isTerminal: z.boolean(),
});

export async function updateStageAction(
  stageId: string,
  input: { name: string; slaHours: number; isActive: boolean; isTerminal: boolean },
) {
  const session = await requireRole(["ADMIN"]);

  const parsed = updateStageSchema.parse(input);

  await prisma.stage.update({
    where: { id: stageId, organizationId: session.user.organizationId },
    data: parsed,
  });

  revalidatePath("/settings/stages");
}

const createStageSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slaHours: z.coerce.number().int().min(0),
});

export async function createStageAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);

  const parsed = createStageSchema.parse({
    name: formData.get("name"),
    slaHours: formData.get("slaHours") || 24,
  });

  const last = await prisma.stage.findFirst({
    where: { organizationId: session.user.organizationId },
    orderBy: { sequence: "desc" },
  });

  await prisma.stage.create({
    data: {
      organizationId: session.user.organizationId,
      name: parsed.name,
      sequence: (last?.sequence ?? 0) + 1,
      slaHours: parsed.slaHours,
    },
  });

  revalidatePath("/settings/stages");
}
