"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireCrmUser } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { requireClientAccess } from "@/lib/auth/client-access";
import { getVisibleUserIds } from "@/lib/auth/visibility";

const taskSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1, "Title is required"),
  dueAt: z.string().min(1, "Due date is required"),
  assignedToId: z.string().min(1),
  source: z.string().min(1).optional(),
});

export const createTaskAction = withUserErrors(async function createTaskAction(formData: FormData) {
  const session = await requireCrmUser();

  const parsed = taskSchema.parse({
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    assignedToId: formData.get("assignedToId"),
    source: formData.get("source") || undefined,
  });

  await requireClientAccess(session.user, parsed.clientId);
  const assignee = await prisma.user.findFirst({ where: { id: parsed.assignedToId, organizationId: session.user.organizationId }, select: { id: true } });
  if (!assignee) throw new UserError("Assignee not found");

  const task = await prisma.task.create({
    data: {
      organizationId: session.user.organizationId,
      clientId: parsed.clientId,
      title: parsed.title,
      dueAt: new Date(parsed.dueAt),
      assignedToId: parsed.assignedToId,
      source: parsed.source ?? "manual",
    },
  });

  revalidatePath("/tasks");
  revalidatePath(`/clients/${parsed.clientId}`);
  revalidatePath("/copilot");
  return task;
});

export const completeTaskAction = withUserErrors(async function completeTaskAction(taskId: string) {
  const session = await requireCrmUser();

  // Same rule as the tasks page: you can complete the tasks you can see (yours, or your team's as a manager).
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId);
  const visible = await prisma.task.findFirst({
    where: { id: taskId, organizationId: session.user.organizationId, ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}) },
    select: { id: true },
  });
  if (!visible) throw new UserError("Task not found");

  const task = await prisma.task.update({
    where: { id: taskId, organizationId: session.user.organizationId },
    data: { status: "DONE" },
  });

  await logActivity({
    clientId: task.clientId,
    userId: session.user.id,
    type: "TASK_COMPLETED",
    payload: { message: `Completed task: ${task.title}` },
  });

  revalidatePath("/tasks");
  revalidatePath(`/clients/${task.clientId}`);
  return task;
});
