import { z } from "zod";

import { prisma } from "@/lib/db/prisma";

import { COST_CHANNELS, DEFAULT_RETENTION_MONTHS, MAX_RETENTION_MONTHS, type CostChannel, type CostSettings } from "@/lib/cx/settings-shared";

export { COST_CHANNELS, DEFAULT_RETENTION_MONTHS, MAX_RETENTION_MONTHS, type CostChannel, type CostSettings };

const money = z.number({ error: "Enter a number" }).min(0, "Amounts can't be negative").max(1_000_000, "That amount looks too large");
// Shares are entered as percentages and stored as 0–1.
const share = z.number({ error: "Enter a number" }).min(0, "Enter a percentage from 0 to 100").max(1, "Enter a percentage from 0 to 100");

export const costSettingsSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD or INR"),
  costPerContact: z.object({
    default: money.nullable(),
    email: money.nullable(),
    chat: money.nullable(),
    voice: money.nullable(),
    social: money.nullable(),
  }) satisfies z.ZodType<Record<CostChannel | "default", number | null>>,
  agentHourlyCost: money.nullable(),
  averageOrderValue: money.nullable(),
  customerLifetimeVal: money.nullable(),
  churnPropensity: share.nullable(),
  deflectionRate: share.nullable(),
  retentionMonths: z
    .number({ error: "Enter a number of months" })
    .int("Enter a whole number of months")
    .min(1, `Keep conversations for 1 to ${MAX_RETENTION_MONTHS} months`)
    .max(MAX_RETENTION_MONTHS, `Keep conversations for 1 to ${MAX_RETENTION_MONTHS} months`),
});
export type CostSettingsInput = z.infer<typeof costSettingsSchema> & CostSettings;

/** The org's cost inputs, or blanks (and 13-month retention) before an admin has set them. */
export async function getCostSettings(organizationId: string): Promise<CostSettings> {
  const row = await prisma.cxCostSettings.findUnique({ where: { organizationId } });
  const perContact = (row?.costPerContact ?? {}) as Partial<Record<CostChannel | "default", number | null>>;
  return {
    currency: row?.currency ?? "USD",
    costPerContact: {
      default: perContact.default ?? null,
      ...(Object.fromEntries(COST_CHANNELS.map((c) => [c, perContact[c] ?? null])) as Record<CostChannel, number | null>),
    },
    agentHourlyCost: row?.agentHourlyCost ?? null,
    averageOrderValue: row?.averageOrderValue ?? null,
    customerLifetimeVal: row?.customerLifetimeVal ?? null,
    churnPropensity: row?.churnPropensity ?? null,
    deflectionRate: row?.deflectionRate ?? null,
    retentionMonths: row?.retentionMonths ?? DEFAULT_RETENTION_MONTHS,
  };
}

/** Normalises an agent-to-team rule's value the way conversations are matched against it. */
export function normalizeMappingValue(matchType: "email" | "domain" | "group", value: string): string {
  const v = value.trim().toLowerCase();
  return matchType === "domain" ? v.replace(/^@/, "") : v;
}

/**
 * The team an agent belongs to: an exact email rule wins over a domain rule, which wins over
 * a helpdesk-group rule. Used when conversations are ingested.
 */
export function matchTeam(
  mappings: { matchType: string; value: string; teamId: string }[],
  agent: { email?: string | null; group?: string | null },
): string | null {
  const email = agent.email?.trim().toLowerCase() ?? "";
  const domain = email.includes("@") ? email.split("@")[1] : "";
  const group = agent.group?.trim().toLowerCase() ?? "";
  for (const [type, value] of [["email", email], ["domain", domain], ["group", group]] as const) {
    if (!value) continue;
    const hit = mappings.find((m) => m.matchType === type && m.value === value);
    if (hit) return hit.teamId;
  }
  return null;
}
