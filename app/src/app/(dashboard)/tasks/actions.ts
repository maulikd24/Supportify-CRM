"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";

const taskSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1, "Title is required"),
  dueAt: z.string().min(1, "Due date is required"),
  assignedToId: z.string().min(1),
  source: z.string().min(1).optional(),
});

export async function createTaskAction(formData: FormData) {
  const session = await requireUser();

  const parsed = taskSchema.parse({
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    assignedToId: formData.get("assignedToId"),
    source: formData.get("source") || undefined,
  });

  const [client, assignee] = await Promise.all([
    prisma.client.findFirst({ where: { id: parsed.clientId, organizationId: session.user.organizationId }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: parsed.assignedToId, organizationId: session.user.organizationId }, select: { id: true } }),
  ]);
  if (!client) throw new Error("Client not found");
  if (!assignee) throw new Error("Assignee not found");

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
}

export async function completeTaskAction(taskId: string) {
  const session = await requireUser();

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
}
