import type { Stage } from "@/generated/prisma/client";
import type { CopilotClient } from "./types";
import { hasContactRecord } from "./types";

export type MilestoneStatus = "done" | "current" | "blocked" | "upcoming";

export type MilestoneItem = {
  stageName: string;
  sequence: number;
  status: MilestoneStatus;
  blockingReason?: string;
};

/** Read-only per-client summary of the org's pipeline: what's done, current, blocked, or upcoming. */
export function getMilestoneChecklist(client: CopilotClient, allStages: Stage[]): MilestoneItem[] {
  const currentSequence = client.currentStage.sequence;

  return [...allStages]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage) => {
      if (stage.sequence < currentSequence) {
        return { stageName: stage.name, sequence: stage.sequence, status: "done" as const };
      }
      if (stage.sequence > currentSequence) {
        return { stageName: stage.name, sequence: stage.sequence, status: "upcoming" as const };
      }

      if (client.status === "COMPLETED") {
        return { stageName: stage.name, sequence: stage.sequence, status: "done" as const };
      }

      const blockingReason = !hasContactRecord(client.activities) ? "Client not yet contacted" : undefined;

      return {
        stageName: stage.name,
        sequence: stage.sequence,
        status: blockingReason ? ("blocked" as const) : ("current" as const),
        blockingReason,
      };
    });
}
