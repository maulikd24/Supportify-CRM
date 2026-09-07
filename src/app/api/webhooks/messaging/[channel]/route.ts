import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getMessagingAdapter } from "@/lib/messaging/registry";
import { logActivity } from "@/lib/activities/log-activity";

type Channel = "whatsapp" | "sms";

function isChannel(value: string): value is Channel {
  return value === "whatsapp" || value === "sms";
}

/** Meta's webhook verification handshake (WhatsApp Cloud API). */
export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (channel !== "whatsapp") return NextResponse.json({ error: "Not applicable" }, { status: 404 });

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 404 });
  }

  const adapter = await getMessagingAdapter(channel);
  const contentType = request.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries(new URLSearchParams(await request.text()));

  const [inbound, statuses] = await Promise.all([
    adapter.handleInboundWebhook(payload),
    adapter.handleStatusWebhook(payload),
  ]);

  for (const msg of inbound) {
    const client = await prisma.client.findFirst({ where: { mobile: msg.fromPhone } });
    if (!client) continue;

    await prisma.message.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        channel,
        provider: adapter.provider,
        direction: "INBOUND",
        body: msg.body,
        status: "DELIVERED",
        externalId: msg.externalId,
      },
    });

    await logActivity({
      clientId: client.id,
      type: "MESSAGE",
      payload: { direction: "INBOUND", channel, body: msg.body },
    });

    if (client.assignedToId) {
      await prisma.notification.create({
        data: {
          organizationId: client.organizationId,
          userId: client.assignedToId,
          type: "inbound_message",
          payload: { clientId: client.id, clientName: client.name, channel, preview: msg.body.slice(0, 140) },
        },
      });
    }
  }

  for (const status of statuses) {
    if (!status.externalId) continue;
    await prisma.message.updateMany({
      where: { externalId: status.externalId },
      data: { status: status.status },
    });
  }

  return NextResponse.json({ ok: true, inbound: inbound.length, statusUpdates: statuses.length });
}
