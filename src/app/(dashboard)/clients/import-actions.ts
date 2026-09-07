"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getFirstStage } from "@/lib/stage-engine/stages";
import { initializeClient } from "@/lib/stage-engine/transitions";
import { parseCsv } from "@/lib/utils/csv";
import type { Prisma } from "@/generated/prisma/client";

export type ImportSummary = { created: number; skipped: number; errors: string[] };

const BASE_COLUMNS = new Set([
  "clientcode",
  "name",
  "mobile",
  "email",
  "clienttype",
  "leadsource",
  "referralsource",
  "dealvalue",
  "priority",
  "status",
  "stage",
  "assignedto",
  "assignedtoemail",
  "createdat",
  "completedat",
  "notes",
]);

export async function importClientsAction(csvText: string): Promise<ImportSummary> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const organizationId = session.user.organizationId;

  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error("No rows found in the CSV.");
  if (rows.length > 2000) throw new Error("Import is limited to 2000 rows at a time.");

  const [customFieldDefs, firstStage, existingMobiles] = await Promise.all([
    prisma.customFieldDefinition.findMany({ where: { organizationId } }),
    getFirstStage(organizationId),
    prisma.client.findMany({ where: { organizationId }, select: { mobile: true } }),
  ]);
  const existingMobileSet = new Set(existingMobiles.map((c) => c.mobile));
  const customFieldKeys = new Map(customFieldDefs.map((f) => [f.key.toLowerCase(), f]));

  const summary: ImportSummary = { created: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const lineNumber = index + 2; // header is line 1
    const name = row.name?.trim();
    const mobile = row.mobile?.trim();

    if (!name || !mobile) {
      summary.errors.push(`Line ${lineNumber}: missing required name/mobile`);
      summary.skipped += 1;
      continue;
    }
    if (existingMobileSet.has(mobile)) {
      summary.errors.push(`Line ${lineNumber}: a client with mobile ${mobile} already exists, skipped`);
      summary.skipped += 1;
      continue;
    }

    const customFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (BASE_COLUMNS.has(key.toLowerCase())) continue;
      const def = customFieldKeys.get(key.toLowerCase());
      if (!def || !value) continue;
      customFields[def.key] = def.fieldType === "NUMBER" ? Number(value) : def.fieldType === "BOOLEAN" ? value.toLowerCase() === "true" : value;
    }

    try {
      const clientCode = await generateClientCode();
      const client = await prisma.client.create({
        data: {
          organizationId,
          clientCode,
          name,
          mobile,
          email: row.email || null,
          clientType: row.clienttype || null,
          leadSource: row.leadsource || "import",
          referralSource: row.referralsource || null,
          dealValue: row.dealvalue ? Number(row.dealvalue) : null,
          notes: row.notes || null,
          customFields: Object.keys(customFields).length > 0 ? (customFields as Prisma.InputJsonValue) : undefined,
          assignedToId: session.user.id,
          currentStageId: firstStage.id,
        },
      });
      await initializeClient(client.id, session.user.id);
      existingMobileSet.add(mobile);
      summary.created += 1;
    } catch (error) {
      summary.errors.push(`Line ${lineNumber}: ${error instanceof Error ? error.message : "failed to create"}`);
      summary.skipped += 1;
    }
  }

  revalidatePath("/clients");
  return summary;
}
