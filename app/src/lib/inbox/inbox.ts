import { prisma } from "@/lib/db/prisma";
import { requireClientAccess, visibleClientsWhere } from "@/lib/auth/client-access";
import type { MessageDirection, MessageStatus, Role } from "@/generated/prisma/client";

/**
 * The WhatsApp/SMS Inbox: conversations are a client's Messages, newest first, limited to the
 * clients the user may see (the same rule as the client pages — client-access.ts).
 */

type Actor = { id: string; role: Role; organizationId: string };

/** WhatsApp only allows free-text replies within 24 hours of the client's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ConversationSummary = {
  clientId: string;
  clientName: string;
  assignedToName: string | null;
  lastMessage: { body: string; direction: MessageDirection; channel: string; createdAt: Date };
  unread: number;
};

export async function listConversations(actor: Actor, limit = 50): Promise<ConversationSummary[]> {
  const clientWhere = await visibleClientsWhere(actor);
  const latest = await prisma.message.groupBy({
    by: ["clientId"],
    where: { organizationId: actor.organizationId, client: clientWhere },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: limit,
  });
  const clientIds = latest.map((l) => l.clientId);
  if (clientIds.length === 0) return [];

  const [lastMessages, unread, clients] = await Promise.all([
    prisma.message.findMany({
      where: { clientId: { in: clientIds } },
      orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
      distinct: ["clientId"],
      select: { clientId: true, body: true, direction: true, channel: true, createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["clientId"],
      where: { clientId: { in: clientIds }, direction: "INBOUND", readAt: null },
      _count: { _all: true },
    }),
    prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, assignedTo: { select: { name: true } } },
    }),
  ]);
  const lastBy = new Map(lastMessages.map((m) => [m.clientId, m]));
  const unreadBy = new Map(unread.map((u) => [u.clientId, u._count._all]));
  const clientBy = new Map(clients.map((c) => [c.id, c]));

  return clientIds.flatMap((clientId) => {
    const client = clientBy.get(clientId);
    const last = lastBy.get(clientId);
    if (!client || !last) return [];
    return [
      {
        clientId,
        clientName: client.name,
        assignedToName: client.assignedTo?.name ?? null,
        lastMessage: { body: last.body, direction: last.direction, channel: last.channel, createdAt: last.createdAt },
        unread: unreadBy.get(clientId) ?? 0,
      },
    ];
  });
}

/** Number of conversations with unread inbound messages the user can see (the sidebar badge). */
export async function countUnreadConversations(actor: Actor): Promise<number> {
  const clientWhere = await visibleClientsWhere(actor);
  const rows = await prisma.message.groupBy({
    by: ["clientId"],
    where: { organizationId: actor.organizationId, direction: "INBOUND", readAt: null, client: clientWhere },
  });
  return rows.length;
}

export type ThreadMessage = {
  id: string;
  direction: MessageDirection;
  channel: string;
  body: string;
  status: MessageStatus;
  createdAt: Date;
};

export type Thread = {
  client: { id: string; name: string; mobile: string };
  messages: ThreadMessage[];
  /** Channel to reply on: the channel of the client's latest inbound message (WhatsApp if none). */
  replyChannel: "whatsapp" | "sms";
  /** When WhatsApp free text stops being allowed; null = closed (templates only). */
  whatsappWindowEndsAt: Date | null;
};

/** Throws "Client not found" (client-access.ts) when the user may not see this client. */
export async function getThread(actor: Actor, clientId: string, now = new Date()): Promise<Thread> {
  await requireClientAccess(actor, clientId);
  const [client, recent] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, mobile: true } }),
    prisma.message.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, direction: true, channel: true, body: true, status: true, createdAt: true },
    }),
  ]);
  const messages = recent.reverse();
  const lastInbound = recent.find((m) => m.direction === "INBOUND");
  return {
    client,
    messages,
    replyChannel: lastInbound?.channel === "sms" ? "sms" : "whatsapp",
    whatsappWindowEndsAt: whatsappWindowEndsAt(messages, now),
  };
}

/** End of the 24-hour free-text window opened by the client's latest inbound WhatsApp message. */
export function whatsappWindowEndsAt(
  messages: Pick<ThreadMessage, "direction" | "channel" | "createdAt">[],
  now = new Date(),
): Date | null {
  const lastInbound = messages
    .filter((m) => m.direction === "INBOUND" && m.channel === "whatsapp")
    .reduce<Date | null>((latest, m) => (!latest || m.createdAt > latest ? m.createdAt : latest), null);
  if (!lastInbound) return null;
  const endsAt = new Date(lastInbound.getTime() + WHATSAPP_WINDOW_MS);
  return endsAt > now ? endsAt : null;
}

/** Marks the client's unread inbound messages read (after the same access check). */
export async function markConversationRead(actor: Actor, clientId: string): Promise<number> {
  await requireClientAccess(actor, clientId);
  const { count } = await prisma.message.updateMany({
    where: { clientId, direction: "INBOUND", readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

export type FirstResponse = { clientId: string; waitedMs: number };

/**
 * First-response times in a client's message history: each time the client writes while not
 * already waiting for a reply, the clock starts; the next outbound message stops it. A client
 * still waiting at the end counts as unanswered. Messages must be one client's, oldest first.
 */
export function computeFirstResponses(
  messages: Pick<ThreadMessage, "direction" | "createdAt">[],
  clientId: string,
): { responses: FirstResponse[]; waitingSince: Date | null } {
  const responses: FirstResponse[] = [];
  let waitingSince: Date | null = null;
  for (const m of messages) {
    if (m.direction === "INBOUND") {
      waitingSince ??= m.createdAt;
    } else if (waitingSince) {
      responses.push({ clientId, waitedMs: m.createdAt.getTime() - waitingSince.getTime() });
      waitingSince = null;
    }
  }
  return { responses, waitingSince };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted.at(mid)! : (sorted.at(mid - 1)! + sorted.at(mid)!) / 2;
}

export type RmResponseStats = { userId: string | null; medianMs: number | null; answered: number; waitingNow: number };

/** Median first-response time per assigned RM over messages since `since`, for clients `actor` can see. */
export async function firstResponseByRm(actor: Actor, since: Date): Promise<RmResponseStats[]> {
  const clientWhere = await visibleClientsWhere(actor);
  const messages = await prisma.message.findMany({
    where: { organizationId: actor.organizationId, createdAt: { gte: since }, client: clientWhere },
    orderBy: [{ clientId: "asc" }, { createdAt: "asc" }],
    select: { clientId: true, direction: true, createdAt: true, client: { select: { assignedToId: true } } },
  });

  const byClient = new Map<string, typeof messages>();
  for (const m of messages) byClient.set(m.clientId, [...(byClient.get(m.clientId) ?? []), m]);

  const byRm = new Map<string | null, { waits: number[]; waitingNow: number }>();
  for (const [clientId, msgs] of byClient) {
    const rm = msgs.at(0)?.client.assignedToId ?? null;
    const { responses, waitingSince } = computeFirstResponses(msgs, clientId);
    const entry = byRm.get(rm) ?? { waits: [], waitingNow: 0 };
    entry.waits.push(...responses.map((r) => r.waitedMs));
    if (waitingSince) entry.waitingNow += 1;
    byRm.set(rm, entry);
  }
  return [...byRm].map(([userId, e]) => ({ userId, medianMs: median(e.waits), answered: e.waits.length, waitingNow: e.waitingNow }));
}
