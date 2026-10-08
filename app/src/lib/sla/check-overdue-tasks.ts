import { prisma } from "@/lib/db/prisma";
import { routeAlerts } from "@/lib/alerts/route";
import type { Alert } from "@/lib/alerts/types";

const EXCESSIVE_OVERDUE_THRESHOLD = 5;

/** Flags PENDING tasks past their due date as OVERDUE and notifies the assignee (and their manager, if severely overdue). */
export async function checkOverdueTasks() {
  const now = new Date();

  const overdueTasks = await prisma.task.findMany({
    where: { status: "PENDING", dueAt: { lt: now } },
    include: { assignedTo: true, client: { include: { currentStage: { select: { name: true } } } } },
    orderBy: { dueAt: "asc" },
    take: 200,
  });

  let flagged = 0;
  const alerts: Alert[] = [];
  for (const task of overdueTasks) {
    // Conditional claim: if an overlapping run already flipped this task, it also sent the alert.
    const { count } = await prisma.task.updateMany({ where: { id: task.id, status: "PENDING" }, data: { status: "OVERDUE" } });
    if (count === 0) continue;
    flagged += 1;
    alerts.push({
      organizationId: task.organizationId,
      type: "task_overdue",
      clientId: task.clientId,
      clientName: task.client.name,
      stage: task.client.currentStage.name,
      taskTitle: task.title,
      assignedToName: task.assignedTo.name,
    });

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

  await routeAlerts(alerts);
  await checkExcessiveRmWorkload(now);

  return { flagged };
}

/** Notifies a manager once per day if a direct report is carrying an excessive overdue-task load. */
async function checkExcessiveRmWorkload(now: Date) {
  const rms = await prisma.user.findMany({ where: { orgRole: { not: "AGENT" }, role: "RM", isActive: true, managerId: { not: null } } });

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
