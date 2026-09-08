import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getAdapter } from "@/lib/integrations/registry";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";

const ACTIVITY_TYPE_BY_EVENT: Record<string, "CALL" | "TICKET" | "MESSAGE"> = {
  call_completed: "CALL",
  ticket_updated: "TICKET",
  campaign_event: "MESSAGE",
};

export async function POST(request: Request, { params }: { params: Promise<{ provider: string; token: string }> }) {
  const { provider, token } = await params;

  // The token alone identifies the tenant — never trust the `provider` path
  // segment or payload for that, since the same provider URL shape is shared
  // by every org.
  const config = await prisma.integrationConfig.findUnique({ where: { webhookToken: token } });
  if (!config || config.provider !== provider) {
    return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });
  }
  const { organizationId } = config;

  let adapter;
  try {
    adapter = await getAdapter(provider, organizationId);
  } catch {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries(new URLSearchParams(await request.text()));

  const headers = Object.fromEntries(request.headers.entries());

  const events = await adapter.handleWebhook(payload, headers);

  for (const event of events) {
    const client = event.clientPhone
      ? await prisma.client.findFirst({ where: { organizationId, mobile: event.clientPhone } })
      : event.clientEmail
        ? await prisma.client.findFirst({ where: { organizationId, email: event.clientEmail } })
        : null;

    if (!client) continue;

    await logActivity({
      clientId: client.id,
      type: ACTIVITY_TYPE_BY_EVENT[event.type] ?? "NOTE",
      payload: { source: provider, eventType: event.type, ...event.payload },
    });

    await onEvent("webhook_received", client.id);
  }

  return NextResponse.json({ ok: true, eventsProcessed: events.length });
}
