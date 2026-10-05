import { ALERT_TYPE_META, type Alert, type AlertChannelKind, type AlertType } from "@/lib/alerts/types";

/** More alerts of one type than this in a single sweep go out as one digest message. */
export const DIGEST_THRESHOLD = 5;
const DIGEST_MAX_LINES = 20;

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** One alert as plain parts: a headline, a detail line and the page it links to. */
export function describeAlert(alert: Alert): { headline: string; detail: string; url: string; linkText: string } {
  const owner = (name: string | null) => (name ? `RM: ${name}` : "Unassigned");
  switch (alert.type) {
    case "stage_sla_breach":
      return {
        headline: `SLA breach: ${alert.clientName}`,
        detail: `Stage: ${alert.stage} · ${owner(alert.assignedToName)}`,
        url: `${appUrl()}/clients/${alert.clientId}`,
        linkText: alert.clientName,
      };
    case "task_overdue":
      return {
        headline: `Overdue task: ${alert.taskTitle.slice(0, 120)}`,
        detail: `Client: ${alert.clientName} · Stage: ${alert.stage} · ${owner(alert.assignedToName)}`,
        url: `${appUrl()}/clients/${alert.clientId}`,
        linkText: alert.clientName,
      };
    case "client_disengaged":
      return {
        headline: `No contact for ${alert.daysQuiet} days: ${alert.clientName}`,
        detail: `Stage: ${alert.stage} · ${owner(alert.assignedToName)}`,
        url: `${appUrl()}/clients/${alert.clientId}`,
        linkText: alert.clientName,
      };
    case "qa_low_score":
      return {
        headline: `Low QA score: ${Math.round(alert.score)} on ticket ${alert.ticketId}`,
        detail: alert.agentName ? `Agent: ${alert.agentName}` : "Agent unknown",
        url: `${appUrl()}/qa/reviews/${alert.reviewId}`,
        linkText: `Ticket ${alert.ticketId}`,
      };
  }
}

/** Slack mrkdwn treats &, < and > as control characters; everything else is literal enough. */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Teams Adaptive Card text is Markdown; neutralize the characters that would reformat a name. */
function teamsEscape(text: string): string {
  return text.replace(/([\\*_[\]()#`>~|])/g, "\\$1");
}

/** The JSON body to POST to a channel's webhook: one alert, or a digest of several of one type. */
export function renderMessage(kind: AlertChannelKind, type: AlertType, alerts: Alert[]): Record<string, unknown> {
  const items = alerts.map(describeAlert);
  const digest = alerts.length > DIGEST_THRESHOLD;
  const title = digest ? `${alerts.length} new alerts: ${ALERT_TYPE_META[type].label}` : items[0].headline;
  const shown = digest ? items.slice(0, DIGEST_MAX_LINES) : items;
  const more = items.length - shown.length;

  if (kind === "slack") {
    const lines = digest
      ? shown.map((i) => `• <${i.url}|${slackEscape(i.linkText)}>: ${slackEscape(i.detail)}`)
      : [slackEscape(items[0].detail), `<${items[0].url}|Open in Supportify>`];
    if (more > 0) lines.push(`…and ${more} more`);
    return {
      text: title, // notification/fallback text
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${slackEscape(title)}*` } },
        { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      ],
    };
  }

  const body = digest
    ? shown.map((i) => ({ type: "TextBlock", wrap: true, spacing: "Small", text: `[${teamsEscape(i.linkText)}](${i.url}): ${teamsEscape(i.detail)}` }))
    : [{ type: "TextBlock", wrap: true, text: teamsEscape(items[0].detail) }];
  if (more > 0) body.push({ type: "TextBlock", wrap: true, spacing: "Small", text: `…and ${more} more` });
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", size: "Medium", weight: "Bolder", wrap: true, text: teamsEscape(title) }, ...body],
          actions: digest ? [] : [{ type: "Action.OpenUrl", title: "Open in Supportify", url: items[0].url }],
        },
      },
    ],
  };
}

/** The "Send test message" body from settings: proves the channel works without a fake alert. */
export function renderTestMessage(kind: AlertChannelKind): Record<string, unknown> {
  const text = "Supportify test message: alerts for this channel are set up correctly.";
  if (kind === "slack") return { text };
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", wrap: true, text }] },
      },
    ],
  };
}
