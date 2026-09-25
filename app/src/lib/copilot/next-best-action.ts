import type { CopilotClient } from "./types";
import { hasContactRecord } from "./types";

export type NbaKind = "contact_client" | "follow_up" | "advance_stage" | "no_action_needed";

export type TemplateCategory = "welcome" | "follow_up_reminder";

export type NextBestAction = {
  kind: NbaKind;
  label: string;
  detail: string;
  suggestedTemplateCategory: TemplateCategory | null;
};

const STALE_CONTACT_DAYS = 5;

/**
 * Generic, stage-agnostic recommendation: has this client been contacted at all, has it gone
 * quiet, or is it just waiting on the next manual stage move. Not a prediction model — just
 * explicit, explainable heuristics over activity recency.
 */
export function getNextBestAction(client: CopilotClient, daysSinceLastActivity: number): NextBestAction {
  if (client.status === "COMPLETED") {
    return { kind: "no_action_needed", label: "Won", detail: "This deal is complete.", suggestedTemplateCategory: null };
  }
  if (client.status !== "ACTIVE") {
    return {
      kind: "no_action_needed",
      label: client.status.replace(/_/g, " "),
      detail: "No action needed while the client is in this status.",
      suggestedTemplateCategory: null,
    };
  }

  if (!hasContactRecord(client.activities)) {
    return {
      kind: "contact_client",
      label: "Make first contact",
      detail: "This client hasn't been contacted yet.",
      suggestedTemplateCategory: "welcome",
    };
  }

  if (daysSinceLastActivity >= STALE_CONTACT_DAYS) {
    return {
      kind: "follow_up",
      label: "Follow up — gone quiet",
      detail: `No activity in ${daysSinceLastActivity} days.`,
      suggestedTemplateCategory: "follow_up_reminder",
    };
  }

  return {
    kind: "advance_stage",
    label: `Move forward from ${client.currentStage.name}`,
    detail: "Client is engaged — decide the next stage move.",
    suggestedTemplateCategory: null,
  };
}
