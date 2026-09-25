"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  StickyNote,
  ArrowRightLeft,
  GitBranch,
  Phone,
  Ticket,
  MessageSquare,
  CheckCircle2,
  Workflow,
} from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { addClientNoteAction } from "@/app/(dashboard)/clients/actions";
import { formatDateTime } from "@/lib/utils/format";
import type { Activity, ActivityType, User } from "@/generated/prisma/client";

const ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  NOTE: StickyNote,
  STATUS_CHANGE: ArrowRightLeft,
  STAGE_CHANGE: GitBranch,
  CALL: Phone,
  TICKET: Ticket,
  MESSAGE: MessageSquare,
  TASK_COMPLETED: CheckCircle2,
  JOURNEY_EVENT: Workflow,
};

type ActivityWithUser = Activity & { user: User | null };

function describeActivity(activity: ActivityWithUser): string {
  const payload = activity.payload as Record<string, unknown> | null;
  const message = typeof payload?.message === "string" ? payload.message : null;
  if (message) return message;

  switch (activity.type) {
    case "STATUS_CHANGE":
      return `Status changed to ${payload?.status ?? "unknown"}`;
    case "STAGE_CHANGE":
      return `Stage changed from ${payload?.fromStage ?? "?"} to ${payload?.toStage ?? "?"}`;
    case "MESSAGE": {
      const direction = payload?.direction === "INBOUND" ? "Received" : "Sent";
      const channel = typeof payload?.channel === "string" ? payload.channel : "message";
      const body = typeof payload?.body === "string" ? payload.body : "";
      return `${direction} ${channel}: ${body}`;
    }
    case "CALL": {
      const status = typeof payload?.status === "string" ? payload.status : "completed";
      const duration = payload?.durationSeconds ? ` (${payload.durationSeconds}s)` : "";
      return `Call ${status}${duration}`;
    }
    case "TICKET": {
      const ticketId = payload?.ticketId ?? payload?.eventType;
      return `Support ticket ${payload?.status ?? "updated"} (#${ticketId})`;
    }
    default:
      return activity.type.replace(/_/g, " ").toLowerCase();
  }
}

export function ActivityTimeline({ activities, clientId }: { activities: ActivityWithUser[]; clientId: string }) {
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return;
    setPending(true);
    try {
      await addClientNoteAction(clientId, note);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add note");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
        <Textarea name="note" placeholder="Add a note..." rows={2} />
        <Button type="submit" size="sm" className="self-end" disabled={pending}>
          {pending ? "Adding..." : "Add Note"}
        </Button>
      </form>

      <div className="flex flex-col gap-3">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No activity yet.</p>
        )}
        {activities.map((activity) => {
          const Icon = ICONS[activity.type];
          return (
            <div key={activity.id} className="flex gap-3 border-b pb-3 last:border-0">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{describeActivity(activity)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {activity.user?.name ?? "System"} · {formatDateTime(activity.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
