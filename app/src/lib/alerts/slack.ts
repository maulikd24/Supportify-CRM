import { appUrl } from "@/lib/alerts/format";

/**
 * "Add to Slack" through Supportify's Slack app, asking only for the `incoming-webhook` scope:
 * the admin picks one channel on Slack's consent screen and we get a webhook URL that can post
 * to that channel and nothing else (no reading messages, no listing channels or users).
 * Needs SLACK_CLIENT_ID and SLACK_CLIENT_SECRET; without them the Slack option is hidden.
 */

export const SLACK_STATE_COOKIE = "slack_oauth_state";

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

export function slackRedirectUri(): string {
  return `${appUrl()}/api/integrations/slack/callback`;
}

export function slackAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID ?? "",
    scope: "incoming-webhook",
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export class SlackOAuthError extends Error {}

/** Exchanges the OAuth code for the channel's incoming-webhook URL. */
export async function exchangeSlackCode(code: string): Promise<{ url: string; channelName: string }> {
  const credentials = Buffer.from(`${process.env.SLACK_CLIENT_ID}:${process.env.SLACK_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${credentials}` },
    body: new URLSearchParams({ code, redirect_uri: slackRedirectUri() }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    team?: { name?: string };
    incoming_webhook?: { channel?: string; url?: string };
  } | null;

  if (!data?.ok) throw new SlackOAuthError(`Slack refused the connection (${data?.error ?? response.status})`);
  const url = data.incoming_webhook?.url;
  // Only ever store a genuine Slack webhook URL; this is what deliveries will POST to.
  if (!url || !url.startsWith("https://hooks.slack.com/")) throw new SlackOAuthError("Slack didn't return a channel webhook");
  const channel = data.incoming_webhook?.channel ?? "Slack channel";
  return { url, channelName: data.team?.name ? `${channel} · ${data.team.name}` : channel };
}
