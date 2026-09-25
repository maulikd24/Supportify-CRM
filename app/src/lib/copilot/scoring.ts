import type { Priority, ClientStatus } from "@/generated/prisma/client";
import type { SlaStatus } from "@/lib/stage-engine/sla-status";

export type PriorityScore = { score: number; reasons: string[] };

/**
 * Deterministic, additive priority score (0-100) for "who should this RM work on next".
 * Weights are intentionally simple and documented, not a learned/ML model — every score
 * comes with the exact reasons that produced it.
 */
export function computePriorityScore(input: {
  priority: Priority;
  slaStatus: SlaStatus;
  overdueTaskCount: number;
  daysSinceLastActivity: number | null;
  clientStatus: ClientStatus;
}): PriorityScore {
  let score = 0;
  const reasons: string[] = [];

  if (input.slaStatus === "OVERDUE") {
    score += 40;
    reasons.push("Stage SLA is overdue");
  } else if (input.slaStatus === "DUE_SOON") {
    score += 20;
    reasons.push("Stage SLA is due soon");
  }

  if (input.overdueTaskCount > 0) {
    score += Math.min(30, input.overdueTaskCount * 15);
    reasons.push(`${input.overdueTaskCount} overdue task${input.overdueTaskCount > 1 ? "s" : ""}`);
  }

  if (input.priority === "HIGH") {
    score += 15;
    reasons.push("High priority client");
  } else if (input.priority === "MEDIUM") {
    score += 5;
  }

  if (input.daysSinceLastActivity !== null) {
    if (input.daysSinceLastActivity >= 7) {
      score += 20;
      reasons.push(`No activity in ${input.daysSinceLastActivity} days`);
    } else if (input.daysSinceLastActivity >= 3) {
      score += 10;
      reasons.push(`No activity in ${input.daysSinceLastActivity} days`);
    }
  }

  return { score: Math.min(100, score), reasons };
}

export type HealthStatus = "HEALTHY" | "AT_RISK" | "CRITICAL";
export type HealthResult = { status: HealthStatus; reasons: string[] };

/** Combines SLA status, stage-age vs benchmark, and activity recency into one health signal. */
export function computeHealthStatus(input: {
  slaStatus: SlaStatus;
  stageAgeHours: number;
  benchmarkAvgHours: number | null;
  daysSinceLastActivity: number | null;
}): HealthResult {
  const reasons: string[] = [];
  let status: HealthStatus = "HEALTHY";

  function escalate(next: HealthStatus, reason: string) {
    reasons.push(reason);
    if (next === "CRITICAL" || status === "HEALTHY") status = next;
  }

  if (input.slaStatus === "OVERDUE") {
    escalate("CRITICAL", "Stage SLA overdue");
  } else if (input.slaStatus === "DUE_SOON") {
    escalate("AT_RISK", "Stage SLA due soon");
  }

  if (input.daysSinceLastActivity !== null) {
    if (input.daysSinceLastActivity >= 7) {
      escalate("CRITICAL", `No activity in ${input.daysSinceLastActivity} days`);
    } else if (input.daysSinceLastActivity >= 3) {
      escalate("AT_RISK", `No activity in ${input.daysSinceLastActivity} days`);
    }
  }

  if (input.benchmarkAvgHours !== null && input.benchmarkAvgHours > 0) {
    const ratio = input.stageAgeHours / input.benchmarkAvgHours;
    if (ratio > 2) {
      escalate("CRITICAL", "Much slower than average in this stage");
    } else if (ratio > 1.25) {
      escalate("AT_RISK", "Slower than average in this stage");
    }
  }

  return { status, reasons };
}
