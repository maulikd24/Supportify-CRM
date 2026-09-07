"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Client, Task, User } from "@/generated/prisma/client";
import { createTaskAction, completeTaskAction } from "@/app/(dashboard)/tasks/actions";
import { formatDateTime } from "@/lib/utils/format";

export function ClientTasksPanel({
  client,
  tasks,
  users,
}: {
  client: Omit<Client, "dealValue"> & { dealValue: number | null };
  tasks: Task[];
  users: Pick<User, "id" | "name">[];
}) {
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createTaskAction(formData);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setPending(false);
    }
  }

  async function handleComplete(taskId: string) {
    try {
      await completeTaskAction(taskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete task");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tasks</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet.</p>}
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className={task.status === "DONE" ? "line-through text-muted-foreground" : ""}>
                  {task.title}
                </p>
                <p className="text-xs text-muted-foreground">Due {formatDateTime(task.dueAt)}</p>
              </div>
              {task.status === "DONE" ? (
                <Badge variant="secondary">Done</Badge>
              ) : task.status === "OVERDUE" ? (
                <Badge variant="destructive" onClick={() => handleComplete(task.id)} className="cursor-pointer">
                  Overdue
                </Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => handleComplete(task.id)}>
                  Mark done
                </Button>
              )}
            </div>
          ))}
        </div>

        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2 border-t pt-4">
          <input type="hidden" name="clientId" value={client.id} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-title">New task</FieldLabel>
              <Input id="task-title" name="title" placeholder="Follow up call..." required />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-due">Due</FieldLabel>
              <Input id="task-due" name="dueAt" type="datetime-local" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-assignee">Assign to</FieldLabel>
              <Select name="assignedToId" defaultValue={client.assignedToId ?? undefined}>
                <SelectTrigger id="task-assignee" className="w-full">
                  <SelectValue placeholder="Select assignee">
                    {(value: string) => users.find((u) => u.id === value)?.name ?? "Select assignee"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding..." : "Add Task"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
