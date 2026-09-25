import { prisma } from "@/lib/db/prisma";

const EXCESSIVE_OVERDUE_THRESHOLD = 5;

/** Flags PENDING tasks past their due date as OVERDUE and notifies the assignee (and their manager, if severely overdue). */
export async function checkOverdueTasks() {
  const now = new Date();

  const overdueTasks = await prisma.task.findMany({
    where: { status: "PENDING", dueAt: { lt: now } },
    include: { assignedTo: true, client: true },
    orderBy: { dueAt: "asc" },
    take: 200,
  });

  for (const task of overdueTasks) {
    await prisma.task.update({ where: { id: task.id }, data: { status: "OVERDUE" } });

    await prisma.notification.create({
      data: {
        organizationId: task.organizationId,
        userId: task.assignedToId,
        type: "task_overdue",
        payload: { taskId: task.id, taskTitle: task.title, clientId: task.clientId, clientName: task.client.name },
      },
    });

    const hoursOverdue = (now.getTime() - task.dueAt.getTime()) / (1000 * 60 * 60);
    if (hoursOverdue > 24 && task.assignedTo.managerId) {
      await prisma.notification.create({
        data: {
          organizationId: task.organizationId,
          userId: task.assignedTo.managerId,
          type: "task_overdue_escalation",
          payload: {
            taskId: task.id,
            taskTitle: task.title,
            clientId: task.clientId,
            clientName: task.client.name,
            assignedToName: task.assignedTo.name,
          },
        },
      });
    }
  }

  await checkExcessiveRmWorkload(now);

  return { flagged: overdueTasks.length };
}

/** Notifies a manager once per day if a direct report is carrying an excessive overdue-task load. */
async function checkExcessiveRmWorkload(now: Date) {
  const rms = await prisma.user.findMany({ where: { role: "RM", isActive: true, managerId: { not: null } } });

  for (const rm of rms) {
    const overdueCount = await prisma.task.count({
      where: { assignedToId: rm.id, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } },
    });
    if (overdueCount < EXCESSIVE_OVERDUE_THRESHOLD || !rm.managerId) continue;

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        userId: rm.managerId,
        type: "excessive_overdue_workload",
        createdAt: { gte: since },
        payload: { path: ["rmId"], equals: rm.id },
      },
    });
    if (alreadyNotified) continue;

    await prisma.notification.create({
      data: {
        organizationId: rm.organizationId,
        userId: rm.managerId,
        type: "excessive_overdue_workload",
        payload: { rmId: rm.id, rmName: rm.name, overdueCount },
      },
    });
  }
}
