"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopilotQuickActions } from "@/components/copilot/quick-actions";
import type { PriorityScore, HealthResult } from "@/lib/copilot/scoring";
import type { NextBestAction } from "@/lib/copilot/next-best-action";
import type { MilestoneItem } from "@/lib/copilot/milestones";
import type { MessageSuggestion } from "@/lib/copilot/message-suggestion";

const HEALTH_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HEALTHY: "default",
  AT_RISK: "secondary",
  CRITICAL: "destructive",
};

const MILESTONE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  done: "default",
  current: "secondary",
  blocked: "destructive",
  upcoming: "outline",
};

export function ClientCopilotPanel({
  clientId,
  assignedToId,
  priority,
  health,
  nba,
  milestones,
  messageSuggestion,
  suggestedFollowUp,
  users,
}: {
  clientId: string;
  assignedToId: string | null;
  priority: PriorityScore;
  health: HealthResult;
  nba: NextBestAction;
  milestones: MilestoneItem[];
  messageSuggestion: MessageSuggestion | null;
  suggestedFollowUp: { title: string; dueAtIso: string };
  users: { id: string; name: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Co-pilot</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge variant={HEALTH_VARIANT[health.status]}>{health.status.replace("_", " ")}</Badge>
          <span className="text-xs text-muted-foreground">Priority {priority.score}</span>
        </div>
        {(health.reasons[0] || priority.reasons[0]) && (
          <p className="text-xs text-muted-foreground -mt-2">{health.reasons[0] ?? priority.reasons[0]}</p>
        )}

        <div>
          <p className="text-sm font-medium">{nba.label}</p>
          <p className="text-xs text-muted-foreground">{nba.detail}</p>
        </div>

        <CopilotQuickActions
          clientId={clientId}
          assignedToId={assignedToId}
          suggestedFollowUp={suggestedFollowUp}
          messageSuggestion={messageSuggestion}
          users={users}
        />

        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Milestones</p>
          <div className="flex flex-col gap-1.5">
            {milestones.map((m) => (
              <div key={m.stageName} className="flex items-center justify-between gap-2 text-xs">
                <span className={m.status === "upcoming" ? "text-muted-foreground" : ""}>{m.stageName}</span>
                <div className="flex items-center gap-1">
                  {m.blockingReason && <span className="text-muted-foreground">{m.blockingReason}</span>}
                  <Badge variant={MILESTONE_VARIANT[m.status]}>{m.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
