import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireCrmUser } from "@/lib/auth/require-role";
import { getThread, listConversations, type Thread } from "@/lib/inbox/inbox";
import { formatDateTime } from "@/lib/utils/format";
import { draftingConfigured } from "@/lib/drafting/claude";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { InboxComposer } from "./inbox-composer";
import { InboxLive } from "./inbox-live";

const STATUS_LABEL: Record<string, string> = { QUEUED: "Queued", SENT: "Sent", DELIVERED: "Delivered", READ: "Read", FAILED: "Failed" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const session = await requireCrmUser();
  const { client: openClientId = null } = await searchParams;

  const conversations = await listConversations(session.user);
  let thread: Thread | null = null;
  if (openClientId) {
    // Not visible or not found → show the list only, the same as a missing conversation.
    thread = await getThread(session.user, openClientId).catch(() => null);
  }
  const templates = thread
    ? await prisma.messageTemplate.findMany({
        where: { organizationId: session.user.organizationId, channel: thread.replyChannel, approved: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, variables: true },
      })
    : [];
  const draftingAvailable =
    thread !== null &&
    draftingConfigured() &&
    (await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId }, select: { aiDraftingEnabled: true } })).aiDraftingEnabled;
  const openUnread = conversations.find((c) => c.clientId === thread?.client.id)?.unread ?? 0;

  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <InboxLive openClientId={thread?.client.id ?? null} hasUnread={openUnread > 0} />

      <Panel eyebrow="Inbox" title="Conversations" className={cn(thread && "hidden lg:flex")}>
        {conversations.length === 0 ? (
          <PanelEmpty>No conversations yet. Messages to and from your clients appear here.</PanelEmpty>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {conversations.map((c) => (
              <li key={c.clientId}>
                <Link
                  href={`/inbox?client=${c.clientId}`}
                  className={cn(
                    "flex flex-col gap-1 px-5 py-3 hover:bg-muted/50",
                    c.clientId === thread?.client.id && "bg-muted",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm", c.unread > 0 ? "font-bold" : "font-medium")}>{c.clientName}</span>
                    {c.unread > 0 && <Badge>{c.unread}</Badge>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {c.lastMessage.direction === "OUTBOUND" ? "You: " : ""}
                    {c.lastMessage.body || "(empty message)"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDateTime(c.lastMessage.createdAt)} · {c.lastMessage.channel === "whatsapp" ? "WhatsApp" : "SMS"}
                    {c.assignedToName ? ` · ${c.assignedToName}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {thread ? (
        <Panel
          eyebrow={thread.replyChannel === "whatsapp" ? "WhatsApp" : "SMS"}
          title={thread.client.name}
          description={thread.client.mobile}
          action={
            <span className="flex gap-3 text-[11px] font-bold">
              <Link href="/inbox" className="text-primary hover:underline lg:hidden">
                All conversations
              </Link>
              <Link href={`/clients/${thread.client.id}`} className="text-primary hover:underline">
                Open client
              </Link>
            </span>
          }
          bodyClassName="flex flex-1 flex-col"
        >
          <ol className="flex flex-1 flex-col gap-2 border-t border-border p-4" aria-label="Messages">
            {thread.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  m.direction === "INBOUND" ? "self-start bg-muted" : "self-end bg-primary/10",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.body || "(empty message)"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDateTime(m.createdAt)}
                  {m.direction === "OUTBOUND" && (
                    <span className={cn(m.status === "FAILED" && "font-bold text-destructive")}> · {STATUS_LABEL[m.status] ?? m.status}</span>
                  )}
                </p>
              </li>
            ))}
          </ol>
          <InboxComposer
            clientId={thread.client.id}
            channel={thread.replyChannel}
            freeTextAllowed={thread.replyChannel === "sms" || thread.whatsappWindowEndsAt !== null}
            templates={templates.map((t) => ({ id: t.id, name: t.name, variables: (t.variables as string[] | null) ?? [] }))}
            draftingAvailable={draftingAvailable}
          />
        </Panel>
      ) : (
        <Panel className="hidden lg:flex">
          <PanelEmpty>Choose a conversation to read and reply.</PanelEmpty>
        </Panel>
      )}
    </div>
  );
}
