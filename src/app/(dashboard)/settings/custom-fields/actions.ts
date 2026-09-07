"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";

function keyify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const createFieldSchema = z.object({
  label: z.string().min(1, "Label is required"),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]),
  options: z.string().optional(),
  required: z.coerce.boolean().optional(),
});

export async function createCustomFieldAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);

  const parsed = createFieldSchema.parse({
    label: formData.get("label"),
    fieldType: formData.get("fieldType"),
    options: formData.get("options") || undefined,
    required: formData.get("required") || undefined,
  });

  const key = keyify(parsed.label);
  if (!key) throw new Error("Label must contain at least one letter or number");

  const existing = await prisma.customFieldDefinition.findUnique({
    where: { organizationId_key: { organizationId: session.user.organizationId, key } },
  });
  if (existing) throw new Error(`A field for "${parsed.label}" already exists`);

  const count = await prisma.customFieldDefinition.count({ where: { organizationId: session.user.organizationId } });

  await prisma.customFieldDefinition.create({
    data: {
      organizationId: session.user.organizationId,
      key,
      label: parsed.label,
      fieldType: parsed.fieldType,
      options:
        parsed.fieldType === "SELECT" && parsed.options
          ? parsed.options.split(",").map((o) => o.trim()).filter(Boolean)
          : undefined,
      required: parsed.required ?? false,
      sortOrder: count,
    },
  });

  revalidatePath("/settings/custom-fields");
}

export async function deleteCustomFieldAction(fieldId: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.customFieldDefinition.delete({
    where: { id: fieldId, organizationId: session.user.organizationId },
  });

  revalidatePath("/settings/custom-fields");
}
