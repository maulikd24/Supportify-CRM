"use client";

import { useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/utils/format";
import type { Notification } from "@/generated/prisma/client";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
  getRecentNotificationsAction,
} from "@/app/(dashboard)/notifications-actions";

export function describeNotification(notification: Notification): string {
  const payload = notification.payload as Record<string, unknown>;
  switch (notification.type) {
    case "task_overdue":
      return `Task "${payload.taskTitle}" for ${payload.clientName} is overdue`;
    case "task_overdue_escalation":
      return `${payload.assignedToName}'s task "${payload.taskTitle}" for ${payload.clientName} is overdue`;
    case "stage_sla_breach":
      return payload.escalated
        ? `${payload.assignedToName}'s client ${payload.clientName} is overdue at ${payload.stage}`
        : `${payload.clientName} is overdue at ${payload.stage}`;
    case "document_rejected":
      return `${payload.documentType} rejected for ${payload.clientName}: ${payload.reason}`;
    case "new_assignment":
      return `You were assigned client ${payload.clientName}`;
    case "hold_started":
      return `${payload.clientName} put on hold: ${payload.reason}`;
    case "client_reopened":
      return `${payload.clientName} reopened: ${payload.reason}`;
    case "excessive_overdue_workload":
      return `${payload.rmName} has ${payload.overdueCount} overdue tasks`;
    case "journey_notify_manager":
      return String(payload.message ?? `Journey flagged client ${payload.clientName} for review`);
    case "client_disengaged":
      return `${payload.clientName} has had no contact in ${payload.daysSinceLastActivity} days`;
    default:
      return notification.type.replace(/_/g, " ");
  }
}

export function NotificationsBell({ unreadCount }: { unreadCount: number }) {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpenChange(open: boolean) {
    if (open && notifications === null) {
      setLoading(true);
      try {
        const recent = await getRecentNotificationsAction();
        setNotifications(recent);
      } finally {
        setLoading(false);
      }
    }
  }

  const list = notifications ?? [];

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative">
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 size-4 justify-center rounded-full p-0 text-[10px]"
              >
                {unreadCount}
              </Badge>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-1.5 py-1 text-xs font-medium text-muted-foreground">
          Notifications
          {unreadCount > 0 && (
            <button
              className="text-xs font-normal hover:underline"
              onClick={() => markAllNotificationsReadAction()}
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {loading && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">Loading...</p>
        )}
        {!loading && list.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">No notifications</p>
        )}
        {list.slice(0, 10).map((notification) => (
          <DropdownMenuItem
            key={notification.id}
            className="flex flex-col items-start gap-0.5 whitespace-normal"
            onClick={() => !notification.readAt && markNotificationReadAction(notification.id)}
          >
            <p className={notification.readAt ? "text-muted-foreground" : "font-medium"}>
              {describeNotification(notification)}
            </p>
            <p className="text-xs text-muted-foreground">{formatDateTime(notification.createdAt)}</p>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
