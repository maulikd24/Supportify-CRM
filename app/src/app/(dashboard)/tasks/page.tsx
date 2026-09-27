import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Panel } from "@/components/dashboard/panel";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableEmpty } from "@/components/page/table-empty";
import { Pagination } from "@/components/page/pagination";
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


  function buildPageHref(page: number): string {
    return page > 1 ? `/tasks?page=${page}` : "/tasks";
  }

  return (
    <Panel eyebrow="Workload" title={`${totalCount.toLocaleString("en-IN")} task${totalCount === 1 ? "" : "s"}`}>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
            {tasks.length === 0 && <TableEmpty colSpan={6}>No tasks yet.</TableEmpty>}
          </TableBody>
        </Table>
      </div>
      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={totalCount} noun="tasks" hrefFor={buildPageHref} />
    </Panel>
  );
}
