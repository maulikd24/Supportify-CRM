import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import { parseTime, type StoredTurn } from "@/lib/cx/ingest/conversation";

export default async function CxConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const { id } = await params;
  const c = await prisma.conversation.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { team: { select: { name: true } }, client: { select: { id: true, name: true } } },
  });
  if (!c) notFound();
  const turns = c.turns as unknown as StoredTurn[];

  const facts = [
    ["Source", `${c.provider} #${c.externalId}`],
    ["Started", formatDateTime(c.startedAt)],
    ["First reply", c.firstReplyAt ? formatDateTime(c.firstReplyAt) : "–"],
    ["Solved", c.solvedAt ? formatDateTime(c.solvedAt) : "–"],
    ["Agent", c.agentName ?? c.agentEmail ?? "–"],
    ["Team", c.team?.name ?? "–"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/cx/conversations" className="text-sm text-muted-foreground hover:underline">
        ← All conversations
      </Link>
      <Panel
        eyebrow="Conversation"
        title={c.subject || "(no subject)"}
        description={c.truncated ? "Long thread: only its opening and end were kept." : undefined}
        action={c.client ? <Link href={`/clients/${c.client.id}`} className="text-xs font-bold text-primary hover:underline">CRM client: {c.client.name}</Link> : undefined}
      >
        <dl className="grid gap-x-6 gap-y-1 border-t border-border p-5 text-xs sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ol className="flex flex-col gap-2 border-t border-border p-4" aria-label="Messages">
          {turns.map((t, i) => (
            <li
              key={i}
              className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", t.role === "customer" ? "self-start bg-muted" : "self-end bg-primary/10")}
            >
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.role === "customer" ? "Customer" : "Agent"}
                {parseTime(t.at) ? ` · ${formatDateTime(parseTime(t.at)!)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
