import { createHash } from "crypto";

import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { getProductAccess } from "@/lib/billing/access";
import { ZendeskAuthError, ZendeskClient, type ZendeskCredentials } from "@/lib/qa/zendesk-client";
import { runReview } from "@/lib/qa/run-review";
import { claimReviewSlot, releaseReviewSlot, reportOverageReview } from "@/lib/qa/usage";
import type { AutoReviewConfig, AutoReviewJob } from "@/generated/prisma/client";

const FIRST_POLL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** Reviews run in parallel per batch; override with AUTO_REVIEW_CONCURRENCY. */
const CONCURRENCY = Math.max(1, Number(process.env.AUTO_REVIEW_CONCURRENCY) || 4);
/** Don't start a review this close to the time budget — one review can take ~20s. */
const REVIEW_HEADROOM_MS = 25_000;

type ZendeskTicketSummary = {
  id?: number | string;
  status?: string;
  tags?: string[];
  satisfaction_rating?: { score?: string } | null;
};

export type SampleReason = "bad_csat" | "sample";

/**
 * Decides whether a solved ticket gets reviewed. Random sampling is
 * deterministic per (org, ticket) so re-polling the same ticket never flips
 * the decision.
 */
export function sampleTicket(
  config: Pick<AutoReviewConfig, "organizationId" | "samplePercent" | "alwaysReviewBadCsat" | "includeTags" | "excludeTags">,
  ticket: ZendeskTicketSummary,
): SampleReason | null {
  const tags = (ticket.tags ?? []).map((t) => t.toLowerCase());
  const exclude = config.excludeTags.map((t) => t.toLowerCase());
  const include = config.includeTags.map((t) => t.toLowerCase());
  if (exclude.some((t) => tags.includes(t))) return null;
  if (include.length > 0 && !include.some((t) => tags.includes(t))) return null;

  if (config.alwaysReviewBadCsat && ticket.satisfaction_rating?.score === "bad") return "bad_csat";

  const bucket = parseInt(createHash("sha256").update(`${config.organizationId}:${ticket.id}`).digest("hex").slice(0, 8), 16) % 100;
  return bucket < config.samplePercent ? "sample" : null;
}

/** Pulls newly solved tickets for one org and queues the sampled ones. */
export async function pollOrganization(organizationId: string): Promise<{ found: number; queued: number }> {
  const [config, connection, access] = await Promise.all([
    prisma.autoReviewConfig.findUnique({ where: { organizationId } }),
    prisma.zendeskConnection.findUnique({ where: { organizationId } }),
    getProductAccess(organizationId, "QA_SENTINEL"),
  ]);
  if (!config?.enabled || !connection?.isValid || !access.allowed) return { found: 0, queued: 0 };

  const pollStartedAt = new Date();
  const since = config.lastPolledAt ?? new Date(pollStartedAt.getTime() - FIRST_POLL_LOOKBACK_MS);
  const zendesk = new ZendeskClient(decryptJson<ZendeskCredentials>(connection.encryptedToken));

  let tickets: ZendeskTicketSummary[];
  try {
    tickets = (await zendesk.searchAllTickets(
      `type:ticket status>=solved updated>${since.toISOString()}`,
    )) as ZendeskTicketSummary[];
  } catch (error) {
    if (error instanceof ZendeskAuthError) {
      // Credentials were revoked: stop polling until an admin re-tests the connection.
      await prisma.zendeskConnection.update({ where: { id: connection.id }, data: { isValid: false, lastCheckedAt: new Date() } });
    }
    throw error;
  }

  const jobs = tickets
    .filter((t) => t.id != null && (t.status === "solved" || t.status === "closed"))
    .map((t) => ({ ticketId: String(t.id), reason: sampleTicket(config, t) }))
    .filter((t): t is { ticketId: string; reason: SampleReason } => t.reason !== null);

  const { count } = await prisma.autoReviewJob.createMany({
    data: jobs.map((j) => ({ organizationId, ticketId: j.ticketId, reason: j.reason })),
    skipDuplicates: true, // already queued or reviewed by an earlier poll
  });
  await prisma.autoReviewConfig.update({ where: { id: config.id }, data: { lastPolledAt: pollStartedAt } });

  return { found: tickets.length, queued: count };
}

/** Polls every org that has auto-review switched on. One failing org never blocks the others. */
export async function pollAllOrganizations(): Promise<{ orgs: number; queued: number; errors: number }> {
  const configs = await prisma.autoReviewConfig.findMany({ where: { enabled: true }, select: { organizationId: true } });
  let queued = 0;
  let errors = 0;
  for (const { organizationId } of configs) {
    try {
      queued += (await pollOrganization(organizationId)).queued;
    } catch (error) {
      errors += 1;
      console.error("Auto-review poll failed", { organizationId, error });
    }
  }
  return { orgs: configs.length, queued, errors };
}

async function finishJob(job: AutoReviewJob, data: Partial<Pick<AutoReviewJob, "status" | "lastError" | "reviewId">>) {
  await prisma.autoReviewJob.update({ where: { id: job.id }, data: { processedAt: new Date(), ...data } });
}

async function processJob(job: AutoReviewJob): Promise<void> {
  const { organizationId, ticketId } = job;
  const [access, config, connection, existing] = await Promise.all([
    getProductAccess(organizationId, "QA_SENTINEL"),
    prisma.autoReviewConfig.findUnique({ where: { organizationId } }),
    prisma.zendeskConnection.findUnique({ where: { organizationId } }),
    prisma.ticketReview.findFirst({ where: { organizationId, ticketId }, select: { id: true } }),
  ]);

  if (!access.allowed) return finishJob(job, { status: "SKIPPED", lastError: "QA Sentinel subscription is not active" });
  if (!config?.enabled) return finishJob(job, { status: "SKIPPED", lastError: "Auto-review was turned off" });
  if (!connection?.isValid) return finishJob(job, { status: "SKIPPED", lastError: "Zendesk is not connected" });
  if (existing) return finishJob(job, { status: "SKIPPED", lastError: "Ticket was already reviewed", reviewId: existing.id });

  const sop = config.sopId
    ? await prisma.sopDocument.findUnique({ where: { id: config.sopId, organizationId } })
    : await prisma.sopDocument.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  if (!sop) return finishJob(job, { status: "SKIPPED", lastError: "No SOP to review against" });

  const slot = await claimReviewSlot(organizationId);
  if (!slot.ok) return finishJob(job, { status: "SKIPPED", lastError: slot.reason });

  try {
    const review = await runReview(organizationId, connection, sop, ticketId, { source: "auto", isOverage: slot.overage });
    if (slot.overage) await reportOverageReview(organizationId, review.id);
    await finishJob(job, { status: "DONE", reviewId: review.id, lastError: null });
  } catch (error) {
    await releaseReviewSlot(organizationId, slot.overage);
    const message = error instanceof Error ? error.message : String(error);
    const giveUp = job.attempts >= MAX_ATTEMPTS || error instanceof ZendeskAuthError;
    await prisma.autoReviewJob.update({
      where: { id: job.id },
      data: giveUp
        ? { status: "FAILED", lastError: message, processedAt: new Date() }
        : { status: "QUEUED", lastError: message, startedAt: null },
    });
  }
}

/**
 * Works through queued jobs until the time budget is nearly used up.
 * Jobs are claimed with a conditional update, so overlapping runs never
 * review the same ticket twice.
 */
export async function processQueue(budgetMs: number, organizationId?: string): Promise<{ processed: number; remaining: number }> {
  const deadline = Date.now() + budgetMs;
  const scope = organizationId ? { organizationId } : {};

  // Recover jobs from a run that died mid-review.
  await prisma.autoReviewJob.updateMany({
    where: { ...scope, status: "PROCESSING", startedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
    data: { status: "QUEUED", startedAt: null },
  });

  let processed = 0;
  while (Date.now() < deadline - REVIEW_HEADROOM_MS) {
    const batch = await prisma.autoReviewJob.findMany({
      where: { ...scope, status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: CONCURRENCY,
    });
    if (batch.length === 0) break;

    const claimed: AutoReviewJob[] = [];
    for (const job of batch) {
      const { count } = await prisma.autoReviewJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 } },
      });
      if (count === 1) claimed.push({ ...job, attempts: job.attempts + 1 });
    }
    await Promise.all(claimed.map(processJob));
    processed += claimed.length;
  }

  const remaining = await prisma.autoReviewJob.count({ where: { ...scope, status: "QUEUED" } });
  return { processed, remaining };
}
