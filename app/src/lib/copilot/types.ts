import type { Client, Stage, Document, Activity } from "@/generated/prisma/client";

export type CopilotClient = Client & {
  currentStage: Stage;
  documents: Document[];
  activities: Pick<Activity, "type" | "payload">[];
};

/** True once recordRmContact has run — mirrors the same signal used in stage-action-card.tsx. */
export function hasContactRecord(activities: Pick<Activity, "type" | "payload">[]): boolean {
  return activities.some(
    (a) => a.type === "NOTE" && a.payload && typeof a.payload === "object" && "contactMethod" in (a.payload as Record<string, unknown>),
  );
}
