import { prisma } from "@/lib/db/prisma";
import { COST_CHANNELS, type CostChannel, type CostSettings } from "@/lib/cx/settings-shared";

/**
 * $ impact: what the problems customers contact you about cost, from the org's own cost inputs.
 * Each conversation is attributed to its primary topic only, so topic figures add up to the total.
 *
 * - Contacts: every conversation × the cost of a contact on its channel.
 * - Repeat contacts: the same customer got in touch again within 7 days; the second contact is waste.
 * - Extra handle time: hours a topic takes above the org's average handle time × agent hourly cost.
 * - Automation: deflectable conversations × contact cost × the share automation could absorb.
 * - Churn exposure: customers at high churn risk × churn propensity × lifetime value.
 *
 * Figures are for the window and annualised (× 365 / days). A figure whose inputs aren't set is null.
 */

export const REPEAT_WITHIN_DAYS = 7;
export const HIGH_CHURN_RISK = 0.6;

export type ImpactRow = {
  topicId: string | null;
  channel: string;
  conversations: number;
  repeats: number;
  deflectable: number;
  highRisk: number;
  handleTimeSum: number;
  handleTimeCount: number;
};

export type ImpactFigures = {
  contactCost: number | null;
  repeatCost: number | null;
  extraHandleCost: number | null;
  automationSavings: number | null;
  churnExposure: number | null;
};

export type TopicImpact = ImpactFigures & {
  topicId: string | null;
  conversations: number;
  repeats: number;
  deflectable: number;
  highRisk: number;
  /** Cost of contacts plus repeat waste, extra handle time and churn exposure. */
  total: number;
};

export type Impact = {
  days: number;
  conversations: number;
  totals: ImpactFigures & { repeats: number; deflectable: number; highRisk: number; extraHandleHours: number | null };
  byTopic: TopicImpact[];
  /** Inputs an admin still needs to set, by the figure they unlock. */
  missing: { input: string; unlocks: string }[];
  /** Channels with conversations but no cost (default included) — they count as zero. */
  unpricedChannels: string[];
};

function contactCostFor(settings: CostSettings, channel: string): number | null {
  const own = (COST_CHANNELS as readonly string[]).includes(channel) ? settings.costPerContact[channel as CostChannel] : null;
  return own ?? settings.costPerContact.default;
}

const sumOrNull = (values: (number | null)[]) => (values.every((v) => v == null) ? null : values.reduce<number>((n, v) => n + (v ?? 0), 0));

/** Pure: turns grouped counts into money. Exported for tests. */
export function computeImpact(rows: ImpactRow[], settings: CostSettings, days: number): Impact {
  const annualise = 365 / days;
  const anyContactCost = Object.values(settings.costPerContact).some((v) => v != null);
  const hourly = settings.agentHourlyCost;
  const deflection = settings.deflectionRate;
  const churnValue = settings.churnPropensity != null && settings.customerLifetimeVal != null ? settings.churnPropensity * settings.customerLifetimeVal : null;

  const totalHandle = rows.reduce((n, r) => n + r.handleTimeSum, 0);
  const totalHandleCount = rows.reduce((n, r) => n + r.handleTimeCount, 0);
  const avgHandleSec = totalHandleCount > 0 ? totalHandle / totalHandleCount : null;

  const unpriced = new Set<string>();
  type Acc = Omit<TopicImpact, "total" | "extraHandleCost"> & { handleTimeSum: number; handleTimeCount: number };
  const topics = new Map<string | null, Acc>();
  for (const r of rows) {
    const acc =
      topics.get(r.topicId) ??
      ({ topicId: r.topicId, conversations: 0, repeats: 0, deflectable: 0, highRisk: 0, contactCost: null, repeatCost: null, automationSavings: null, churnExposure: null, handleTimeSum: 0, handleTimeCount: 0 } as Acc);
    acc.conversations += r.conversations;
    acc.repeats += r.repeats;
    acc.deflectable += r.deflectable;
    acc.highRisk += r.highRisk;
    acc.handleTimeSum += r.handleTimeSum;
    acc.handleTimeCount += r.handleTimeCount;
    const unit = contactCostFor(settings, r.channel);
    if (unit == null) {
      if (r.conversations > 0) unpriced.add(r.channel);
    } else if (anyContactCost) {
      acc.contactCost = (acc.contactCost ?? 0) + r.conversations * unit * annualise;
      acc.repeatCost = (acc.repeatCost ?? 0) + r.repeats * unit * annualise;
      if (deflection != null) acc.automationSavings = (acc.automationSavings ?? 0) + r.deflectable * unit * deflection * annualise;
    }
    topics.set(r.topicId, acc);
  }

  let extraHandleSec = 0;
  const byTopic: TopicImpact[] = [...topics.values()].map(({ handleTimeSum, handleTimeCount, ...t }) => {
    // Time above the average, on the conversations whose handle time is known.
    const extraSec = avgHandleSec != null && handleTimeCount > 0 ? Math.max(0, handleTimeSum - avgHandleSec * handleTimeCount) : 0;
    extraHandleSec += extraSec;
    const extraHandleCost = hourly != null && avgHandleSec != null ? (extraSec / 3600) * hourly * annualise : null;
    const churnExposure = churnValue != null ? t.highRisk * churnValue * annualise : null;
    const total = (t.contactCost ?? 0) + (extraHandleCost ?? 0) + (churnExposure ?? 0);
    return { ...t, extraHandleCost, churnExposure, total };
  });
  byTopic.sort((a, b) => b.total - a.total || b.conversations - a.conversations);

  const missing: Impact["missing"] = [];
  if (!anyContactCost) missing.push({ input: "Cost per contact", unlocks: "contact, repeat-contact and automation figures" });
  if (hourly == null) missing.push({ input: "Agent hourly cost", unlocks: "extra handle time" });
  if (deflection == null) missing.push({ input: "Deflection rate", unlocks: "automation savings" });
  if (churnValue == null) missing.push({ input: "Churn propensity and customer lifetime value", unlocks: "churn exposure" });

  return {
    days,
    conversations: byTopic.reduce((n, t) => n + t.conversations, 0),
    totals: {
      contactCost: sumOrNull(byTopic.map((t) => t.contactCost)),
      repeatCost: sumOrNull(byTopic.map((t) => t.repeatCost)),
      extraHandleCost: sumOrNull(byTopic.map((t) => t.extraHandleCost)),
      automationSavings: sumOrNull(byTopic.map((t) => t.automationSavings)),
      churnExposure: sumOrNull(byTopic.map((t) => t.churnExposure)),
      repeats: byTopic.reduce((n, t) => n + t.repeats, 0),
      deflectable: byTopic.reduce((n, t) => n + t.deflectable, 0),
      highRisk: byTopic.reduce((n, t) => n + t.highRisk, 0),
      extraHandleHours: avgHandleSec != null ? extraHandleSec / 3600 : null,
    },
    byTopic,
    missing,
    unpricedChannels: anyContactCost ? [...unpriced].sort() : [],
  };
}

/** Conversation counts for one org and window, grouped by primary topic and channel. */
export async function impactRows(organizationId: string, from: Date, to: Date): Promise<ImpactRow[]> {
  const rows = await prisma.$queryRaw<
    { topicId: string | null; channel: string; conversations: bigint; repeats: bigint; deflectable: bigint; highRisk: bigint; handleTimeSum: bigint | null; handleTimeCount: bigint }[]
  >`
    SELECT ct."topicId" AS "topicId", COALESCE(c.channel, 'unknown') AS channel,
      count(*) AS conversations,
      count(*) FILTER (WHERE c."customerKey" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "Conversation" p
        WHERE p."organizationId" = c."organizationId" AND p."customerKey" = c."customerKey" AND p.id <> c.id
          AND p."startedAt" < c."startedAt" AND p."startedAt" >= c."startedAt" - make_interval(days => ${REPEAT_WITHIN_DAYS}::int)
      )) AS repeats,
      count(*) FILTER (WHERE a.deflectable) AS deflectable,
      count(*) FILTER (WHERE a."churnRisk" >= ${HIGH_CHURN_RISK}) AS "highRisk",
      sum(c."handleTimeSec") AS "handleTimeSum", count(c."handleTimeSec") AS "handleTimeCount"
    FROM "Conversation" c
    LEFT JOIN "ConversationAnalysis" a ON a."conversationId" = c.id
    LEFT JOIN "ConversationTopic" ct ON ct."conversationId" = c.id AND ct."isPrimary"
    WHERE c."organizationId" = ${organizationId} AND c."startedAt" >= ${from} AND c."startedAt" < ${to}
    GROUP BY 1, 2`;
  return rows.map((r) => ({
    topicId: r.topicId,
    channel: r.channel,
    conversations: Number(r.conversations),
    repeats: Number(r.repeats),
    deflectable: Number(r.deflectable),
    highRisk: Number(r.highRisk),
    handleTimeSum: Number(r.handleTimeSum ?? 0),
    handleTimeCount: Number(r.handleTimeCount),
  }));
}

export async function impactFor(organizationId: string, settings: CostSettings, from: Date, to: Date): Promise<Impact> {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  return computeImpact(await impactRows(organizationId, from, to), settings, days);
}

/** Change from the previous period, as a share (0.25 = +25%); null without a base to compare. */
export function periodChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}
