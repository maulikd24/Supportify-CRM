import Link from "next/link";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import type { CxAnalysisStatus, Prisma } from "@/generated/prisma/client";

const PAGE = 50;
const STATUS_LABEL: Record<CxAnalysisStatus, string> = {
  PENDING: "Waiting for analysis",
  QUEUED: "Analysing",
  DONE: "Analysed",
  FAILED: "Analysis failed",
  SKIPPED_QUOTA: "Over this month's limit",
};

export default async function CxConversationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const { q = "", status = "", page: pageParam = "1" } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);

  const where: Prisma.ConversationWhereInput = {
    organizationId,
    ...(status in STATUS_LABEL ? { analysisStatus: status as CxAnalysisStatus } : {}),
    ...(q.trim() ? { OR: [{ subject: { contains: q.trim(), mode: "insensitive" } }, { externalId: q.trim().replace(/^#/, "") }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: { id: true, externalId: true, provider: true, subject: true, startedAt: true, replyCount: true, analysisStatus: true, team: { select: { name: true } } },
    }),
    prisma.conversation.count({ where }),
  ]);
  const query = (next: Record<string, string>) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...next })}`;

  return (
    <Panel eyebrow="CX Intelligence" title="Conversations" description={`${formatNumber(total)} conversations, newest first. Personal details are already removed.`}>
      <form className="flex flex-wrap gap-2 border-t border-border p-4" action="/cx/conversations">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search subject or ticket id"
          aria-label="Search conversations"
          className="h-9 min-w-56 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <select name="status" defaultValue={status} aria-label="Analysis status" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm font-medium">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <PanelEmpty>{q || status ? "No conversations match." : "No conversations yet. Connect a source to start importing."}</PanelEmpty>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conversation</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Replies</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-md">
                    <Link href={`/cx/conversations/${c.id}`} className="block truncate font-medium hover:underline">
                      {c.subject || "(no subject)"}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {c.provider} #{c.externalId}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(c.startedAt)}</TableCell>
                  <TableCell className="text-xs">{c.team?.name ?? "–"}</TableCell>
                  <TableCell className="text-xs">{c.replyCount ?? "–"}</TableCell>
                  <TableCell>
                    <Badge variant={c.analysisStatus === "DONE" ? "success" : c.analysisStatus === "FAILED" ? "destructive" : "secondary"}>
                      {STATUS_LABEL[c.analysisStatus]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > PAGE && (
        <div className="flex justify-between border-t border-border px-4 py-3 text-sm">
          {page > 1 ? <Link href={query({ page: String(page - 1) })}>← Newer</Link> : <span />}
          <span className="text-muted-foreground">
            Page {page} of {Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total ? <Link href={query({ page: String(page + 1) })}>Older →</Link> : <span />}
        </div>
      )}
    </Panel>
  );
}
