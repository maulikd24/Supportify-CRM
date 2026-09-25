export const WEBHOOK_EVENTS = ["client.created", "client.stage_changed", "review.completed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
