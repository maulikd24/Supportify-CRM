import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey, requireApiProductAccess, unauthorized } from "@/lib/api/auth";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getFirstStage } from "@/lib/stage-engine/stages";
import { initializeClient } from "@/lib/stage-engine/transitions";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import type { Prisma } from "@/generated/prisma/client";

const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return unauthorized();
  const gate = await requireApiProductAccess(auth.organizationId, "CRM");
  if (gate) return gate;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, MAX_PAGE_SIZE);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const clients = await prisma.client.findMany({
    where: { organizationId: auth.organizationId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { currentStage: { select: { name: true } } },
  });

  const hasMore = clients.length > limit;
  const page = clients.slice(0, limit);

  return NextResponse.json({
    data: page.map(serializeClient),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

const createClientSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().min(1),
  email: z.string().email().optional(),
  leadSource: z.string().optional(),
  notes: z.string().optional(),
  dealValue: z.number().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return unauthorized();
  const gate = await requireApiProductAccess(auth.organizationId, "CRM");
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const [clientCode, stage1] = await Promise.all([generateClientCode(), getFirstStage(auth.organizationId)]);

  const client = await prisma.client.create({
    data: {
      organizationId: auth.organizationId,
      clientCode,
      name: parsed.data.name,
      mobile: parsed.data.mobile,
      email: parsed.data.email ?? null,
      leadSource: parsed.data.leadSource ?? "api",
      notes: parsed.data.notes ?? null,
      dealValue: parsed.data.dealValue ?? null,
      customFields: parsed.data.customFields as Prisma.InputJsonValue | undefined,
      currentStageId: stage1.id,
    },
    include: { currentStage: { select: { name: true } } },
  });

  // API-created clients still need a real User for the FK'd stage-history/audit
  // trail — attribute it to whoever generated the key.
  await initializeClient(client.id, auth.createdById);

  void dispatchWebhookEvent(auth.organizationId, "client.created", {
    id: client.id,
    clientCode: client.clientCode,
    name: client.name,
    email: client.email,
    mobile: client.mobile,
    leadSource: client.leadSource,
  });

  return NextResponse.json({ data: serializeClient(client) }, { status: 201 });
}

function serializeClient(client: {
  id: string;
  clientCode: string;
  name: string;
  mobile: string;
  email: string | null;
  leadSource: string | null;
  dealValue: unknown;
  status: string;
  currentStage: { name: string };
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
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
  };
}
