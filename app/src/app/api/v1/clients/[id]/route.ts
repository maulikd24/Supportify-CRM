import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey, requireApiProductAccess, unauthorized } from "@/lib/api/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return unauthorized();
  const gate = await requireApiProductAccess(auth.organizationId, "CRM");
  if (gate) return gate;

  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id, organizationId: auth.organizationId },
    include: { currentStage: { select: { name: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  return NextResponse.json({
    data: {
      id: client.id,
      clientCode: client.clientCode,
      name: client.name,
      mobile: client.mobile,
      email: client.email,
      leadSource: client.leadSource,
      dealValue: client.dealValue ? String(client.dealValue) : null,
      status: client.status,
      stage: client.currentStage.name,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    },
  });
}
