"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/format";
import type { Task, Client, User } from "@/generated/prisma/client";
import { completeTaskAction } from "./actions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  DONE: "secondary",
  OVERDUE: "destructive",
  CANCELLED: "secondary",
};

type TaskRowData = Task & { client: Client; assignedTo: User };

export function TaskRow({ task }: { task: TaskRowData }) {
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(task.status);
  const [isPending, startTransition] = useTransition();

  function handleComplete() {
    startTransition(async () => {
      setOptimisticStatus("DONE");
      try {
        await completeTaskAction(task.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to complete task");
      }
    });
  }

  const isDone = optimisticStatus === "DONE";

  return (
    <TableRow>
      <TableCell className={isDone ? "line-through text-muted-foreground" : ""}>{task.title}</TableCell>
      <TableCell className="text-sm">
        <a href={`/clients/${task.clientId}`} className="hover:underline">
          {task.client.name}
        </a>
      </TableCell>
      <TableCell className="text-sm">{task.assignedTo.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDateTime(task.dueAt)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[optimisticStatus]}>{optimisticStatus}</Badge>
      </TableCell>
      <TableCell>
        {!isDone && (
          <Button size="sm" variant="outline" onClick={handleComplete} disabled={isPending}>
            {isPending ? "Completing..." : "Mark done"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
