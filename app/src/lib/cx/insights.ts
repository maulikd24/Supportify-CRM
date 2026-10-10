import { prisma } from "@/lib/db/prisma";

/** Dashboard reads, all from the daily totals in CxMetricBucket (never the raw conversations). */

export type DayPoint = { day: Date; conversations: number; sentiment: number | null; negativeShare: number | null; predictedCsat: number | null };

type BucketSums = {
  conversations: number;
  sentimentSum: number;
  sentimentCount: number;
  negativeCount: number;
  predictedCsatSum: number;
  predictedCsatCount: number;
};

const avg = (sum: number, count: number) => (count > 0 ? sum / count : null);

export function toPoint(day: Date, b: BucketSums): DayPoint {
  return {
    day,
    conversations: b.conversations,
    sentiment: avg(b.sentimentSum, b.sentimentCount),
    negativeShare: avg(b.negativeCount, b.sentimentCount),
    predictedCsat: avg(b.predictedCsatSum, b.predictedCsatCount),
  };
}

/** One point per UTC day from `from` for `days` days, zero-filled where nothing came in. */
export async function dailySeries(organizationId: string, dimension: string, dimensionId: string, from: Date, days: number): Promise<DayPoint[]> {
  const to = new Date(from.getTime() + days * 86_400_000);
  const rows = await prisma.cxMetricBucket.findMany({ where: { organizationId, dimension, dimensionId, day: { gte: from, lt: to } } });
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r]));
  const empty: BucketSums = { conversations: 0, sentimentSum: 0, sentimentCount: 0, negativeCount: 0, predictedCsatSum: 0, predictedCsatCount: 0 };
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(from.getTime() + i * 86_400_000);
    return toPoint(day, byDay.get(day.toISOString().slice(0, 10)) ?? empty);
  });
}

export type Slice = { id: string; conversations: number; sentiment: number | null; negativeShare: number | null; predictedCsat: number | null };

/** Totals per value of a dimension (channel, source, topic, team) over [from, to). */
export async function breakdown(organizationId: string, dimension: string, from: Date, to: Date): Promise<Slice[]> {
  const rows = await prisma.cxMetricBucket.groupBy({
    by: ["dimensionId"],
    where: { organizationId, dimension, day: { gte: from, lt: to } },
    _sum: { conversations: true, sentimentSum: true, sentimentCount: true, negativeCount: true, predictedCsatSum: true, predictedCsatCount: true },
  });
  return rows
    .map((r) => {
      const s = r._sum;
      const p = toPoint(from, {
        conversations: s.conversations ?? 0,
        sentimentSum: s.sentimentSum ?? 0,
        sentimentCount: s.sentimentCount ?? 0,
        negativeCount: s.negativeCount ?? 0,
        predictedCsatSum: s.predictedCsatSum ?? 0,
        predictedCsatCount: s.predictedCsatCount ?? 0,
      });
      return { id: r.dimensionId, conversations: p.conversations, sentiment: p.sentiment, negativeShare: p.negativeShare, predictedCsat: p.predictedCsat };
    })
    .sort((a, b) => b.conversations - a.conversations);
}

export type Mover = { topicId: string; current: number; previous: number; change: number };

/** Minimum conversations (in either period) before a topic can be a mover; avoids 1 → 3 = +200%. */
export const MOVER_MIN_VOLUME = 5;

/**
 * Topics whose volume changed most between the last `days` days and the `days` before, by
 * absolute change. Pure: takes both periods' per-topic counts.
 */
export function rankMovers(current: Map<string, number>, previous: Map<string, number>, limit = 5): { rising: Mover[]; falling: Mover[] } {
  const ids = new Set([...current.keys(), ...previous.keys()]);
  const all: Mover[] = [...ids]
    .map((topicId) => {
      const c = current.get(topicId) ?? 0;
      const p = previous.get(topicId) ?? 0;
      return { topicId, current: c, previous: p, change: c - p };
    })
    .filter((m) => Math.max(m.current, m.previous) >= MOVER_MIN_VOLUME && m.change !== 0);
  return {
    rising: all.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, limit),
    falling: all.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, limit),
  };
}

export async function topMovers(organizationId: string, end: Date, days = 7) {
  const mid = new Date(end.getTime() - days * 86_400_000);
  const start = new Date(mid.getTime() - days * 86_400_000);
  const [current, previous] = await Promise.all([breakdown(organizationId, "topic", mid, end), breakdown(organizationId, "topic", start, mid)]);
  return rankMovers(new Map(current.map((s) => [s.id, s.conversations])), new Map(previous.map((s) => [s.id, s.conversations])));
}

/** Midnight UTC of the given day: the daily totals are kept by UTC day. */
export function utcDayStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
