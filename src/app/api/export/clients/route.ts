import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { toCsv } from "@/lib/utils/csv";

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const [clients, customFieldDefs] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId },
      include: { currentStage: true, assignedTo: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customFieldDefinition.findMany({ where: { organizationId: session.user.organizationId } }),
  ]);

  const baseColumns = [
    "clientCode",
    "name",
    "mobile",
    "email",
    "clientType",
    "leadSource",
    "referralSource",
    "dealValue",
    "priority",
    "status",
    "stage",
    "assignedTo",
    "assignedToEmail",
    "createdAt",
    "completedAt",
    "notes",
  ];
  const customColumns = customFieldDefs.map((f) => f.key);

  const rows = clients.map((c) => {
    const customFields = (c.customFields as Record<string, unknown> | null) ?? {};
    const row: Record<string, unknown> = {
      clientCode: c.clientCode,
      name: c.name,
      mobile: c.mobile,
      email: c.email,
      clientType: c.clientType,
      leadSource: c.leadSource,
      referralSource: c.referralSource,
      dealValue: c.dealValue,
      priority: c.priority,
      status: c.status,
      stage: c.currentStage.name,
      assignedTo: c.assignedTo?.name ?? "",
      assignedToEmail: c.assignedTo?.email ?? "",
      createdAt: c.createdAt,
      completedAt: c.completedAt,
      notes: c.notes,
    };
    for (const key of customColumns) row[key] = customFields[key] ?? "";
    return row;
  });

  const csv = toCsv(rows, [...baseColumns, ...customColumns]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clients-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
