/**
 * Team alerts routed to Slack/Teams channels. Each type is raised by an existing background
 * sweep after its once-per-episode claim (or, for QA, once per review), so a channel never
 * gets the same alert twice. Payloads deliberately carry no client contact details: only
 * names, stage and a link back into Supportify.
 */

export const ALERT_TYPES = ["stage_sla_breach", "task_overdue", "client_disengaged", "qa_low_score", "client_support_risk"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_TYPE_META: Record<AlertType, { label: string; description: string }> = {
  stage_sla_breach: { label: "SLA breaches", description: "A client has been in a stage longer than its SLA." },
  task_overdue: { label: "Overdue tasks", description: "A task passed its due date without being completed." },
  client_disengaged: { label: "Disengaged clients", description: "No activity or messages with a client for 5 days." },
  qa_low_score: { label: "Low QA scores", description: "A QA Sentinel review scored below 70." },
  client_support_risk: {
    label: "Support quality drops",
    description: "A high-priority client's recent support tickets average below 70 (needs QA Sentinel).",
  },
};

export type Alert = { organizationId: string } & (
  | { type: "stage_sla_breach"; clientId: string; clientName: string; stage: string; assignedToName: string | null }
  | { type: "task_overdue"; clientId: string; clientName: string; stage: string; taskTitle: string; assignedToName: string | null }
  | { type: "client_disengaged"; clientId: string; clientName: string; stage: string; daysQuiet: number; assignedToName: string | null }
  | { type: "qa_low_score"; reviewId: string; ticketId: string; agentName: string | null; score: number }
  | { type: "client_support_risk"; clientId: string; clientName: string; stage: string; averageScore: number; assignedToName: string | null }
);

export const ALERT_CHANNEL_KINDS = ["slack", "teams"] as const;
export type AlertChannelKind = (typeof ALERT_CHANNEL_KINDS)[number];
