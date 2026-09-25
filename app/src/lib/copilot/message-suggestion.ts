import type { MessageTemplate, User } from "@/generated/prisma/client";
import type { CopilotClient } from "./types";
import type { NextBestAction } from "./next-best-action";

export type MessageSuggestion = {
  channel: "whatsapp" | "sms";
  templateId: string;
  templateName: string;
  variables: Record<string, string>;
};

type TemplateInput = Pick<MessageTemplate, "id" | "name" | "channel" | "variables" | "approved">;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  welcome: ["welcome", "greeting", "onboard"],
  follow_up_reminder: ["follow up", "followup", "reminder", "check in", "checkin"],
};

/**
 * Picks which approved template best fits the client's current next-best-action, and pre-fills
 * its {{variables}} from real client data. Returns null (no forced/fake draft) if nothing matches —
 * the UI should hide the suggestion in that case rather than guess.
 */
export function suggestMessageTemplate(
  nba: NextBestAction,
  client: CopilotClient & { assignedTo: Pick<User, "name"> | null },
  templates: TemplateInput[],
): MessageSuggestion | null {
  if (!nba.suggestedTemplateCategory) return null;

  const keywords = CATEGORY_KEYWORDS[nba.suggestedTemplateCategory] ?? [];
  const approved = templates.filter((t) => t.approved);
  const matches = approved.filter((t) => keywords.some((k) => t.name.toLowerCase().includes(k)));
  if (matches.length === 0) return null;

  const template = matches.find((t) => t.channel === "whatsapp") ?? matches[0];
  const channel = template.channel === "sms" ? "sms" : "whatsapp";
  const variableNames = (template.variables as string[] | null) ?? [];

  const values: Record<string, string> = {
    clientName: client.name,
    rmName: client.assignedTo?.name ?? "",
    stage: client.currentStage.name,
    dealValue: client.dealValue ? String(client.dealValue) : "",
  };

  const variables: Record<string, string> = {};
  for (const name of variableNames) {
    if (name in values) variables[name] = values[name];
  }

  return { channel, templateId: template.id, templateName: template.name, variables };
}
