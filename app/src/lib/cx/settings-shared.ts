/** CX settings values safe to import from client components (no database access). */

/** Channels a support contact can come in on; each can have its own cost. */
export const COST_CHANNELS = ["email", "chat", "voice", "social"] as const;
export type CostChannel = (typeof COST_CHANNELS)[number];

export const DEFAULT_RETENTION_MONTHS = 13;
export const MAX_RETENTION_MONTHS = 36;

export type CostSettings = {
  currency: string;
  costPerContact: Record<CostChannel | "default", number | null>;
  agentHourlyCost: number | null;
  averageOrderValue: number | null;
  customerLifetimeVal: number | null;
  churnPropensity: number | null;
  deflectionRate: number | null;
  retentionMonths: number;
};

/** How far back a source's first import can reach (trials are capped at 30 days). */
export const BACKFILL_DAYS = [30, 90, 180, 365] as const;
