import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TaskRow } from "./task-row";

const PAGE_SIZE = 25;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireUser();
  const params = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId);
  const currentPage = Math.max(1, Number(params.page) || 1);

  const where = visibleUserIds
    ? { organizationId: session.user.organizationId, assignedToId: { in: visibleUserIds } }
    : { organizationId: session.user.organizationId };

  const [tasks, totalCount] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { client: true, assignedTo: true },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.task.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function buildPageHref(page: number): string {
    return page > 1 ? `/tasks?page=${page}` : "/tasks";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No tasks yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            {totalCount === 0 ? "0 tasks" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalCount)} of ${totalCount}`}
          </p>
          <div className="flex gap-2">
            {currentPage <= 1 ? (
              <Button size="sm" variant="outline" disabled>
                Previous
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link href={buildPageHref(currentPage - 1)} />}>
                Previous
              </Button>
            )}
            {currentPage >= totalPages ? (
              <Button size="sm" variant="outline" disabled>
                Next
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link href={buildPageHref(currentPage + 1)} />}>
                Next
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
