import { Prisma } from "@/generated/prisma/client";
import type { CxIngestJob, CxSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getProductAccess } from "@/lib/billing/access";
import { getHelpdeskProvider, helpdeskClient, HelpdeskAuthError, isHelpdeskProvider, TicketNotFoundError } from "@/lib/qa/helpdesks";
import { matchTeam } from "@/lib/cx/settings";
import { normalizeRequester, resolveClient } from "@/lib/support-health/link";
import { buildConversation, parseTime } from "@/lib/cx/ingest/conversation";

/**
 * CX helpdesk import: every solved ticket since the source's backfill start is listed into a
 * job queue, then each job fetches the ticket, redacts it and upserts its Conversation.
 * Runs from the self-chaining cx-worker route; jobs are claimed atomically so overlapping
 * runs never fetch a ticket twice.
 */

/** Tickets listed per poll from providers that list oldest first (more pages follow on later polls). */
export const PAGE_SIZE = 500;
/** Providers that can't list oldest first get one large page per poll. */
export const UNORDERED_LIMIT = 5_000;
/** Helpdesk search indexes lag; each caught-up poll re-reads this much to catch late arrivals. */
const CATCH_UP_OVERLAP_MS = 10 * 60_000;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 10 * 60_000;
const JOB_HEADROOM_MS = 8_000;

type HelpdeskSource = CxSource & { type: "HELPDESK" };

async function connectionFor(source: CxSource) {
  const connection = await prisma.helpdeskConnection.findUnique({ where: { organizationId: source.organizationId } });
  if (!connection) return { error: "The helpdesk was disconnected" } as const;
  if (connection.provider !== source.provider) return { error: "The organization switched to a different helpdesk" } as const;
  return { connection } as const;
}

/**
 * Lists one page of solved tickets after the source's cursor and queues them. A ticket listed
 * again with a newer "updated" value (reopened and solved again) is re-queued.
 */
export async function pollHelpdeskSource(
  source: HelpdeskSource,
  now = new Date(),
  { pageSize = PAGE_SIZE }: { pageSize?: number } = {},
): Promise<{ listed: number; more: boolean }> {
  const found = await connectionFor(source);
  if ("error" in found) {
    await prisma.cxSource.update({ where: { id: source.id }, data: { status: "paused", lastError: found.error } });
    return { listed: 0, more: false };
  }
  if (!isHelpdeskProvider(found.connection.provider)) return { listed: 0, more: false };
  const ordered = getHelpdeskProvider(found.connection.provider).listsOldestFirst === true;
  const since = parseTime(source.cursor) ?? source.backfillFrom ?? new Date(now.getTime() - 24 * 60 * 60_000);

  let tickets;
  try {
    tickets = await helpdeskClient(found.connection).listSolvedSince(since, ordered ? pageSize : UNORDERED_LIMIT);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Listing tickets failed";
    await prisma.cxSource.update({
      where: { id: source.id },
      data: error instanceof HelpdeskAuthError ? { status: "error", lastError: message } : { lastError: message },
    });
    return { listed: 0, more: false };
  }

  for (const t of tickets) {
    // New tickets are queued; known ones only when their "updated" value changed, and never
    // while a run is fetching them.
    await prisma.$executeRaw`
      INSERT INTO "CxIngestJob" (id, "organizationId", "sourceId", "externalId", "listedUpdatedAt", status, attempts, "createdAt")
      VALUES (${`cxj_${crypto.randomUUID()}`}, ${source.organizationId}, ${source.id}, ${t.id}, ${t.updatedAt ?? null}, 'QUEUED', 0, now() AT TIME ZONE 'UTC')
      ON CONFLICT ("sourceId", "externalId") DO UPDATE
        SET status = 'QUEUED', attempts = 0, "lastError" = NULL, "listedUpdatedAt" = EXCLUDED."listedUpdatedAt"
        WHERE "CxIngestJob"."listedUpdatedAt" IS DISTINCT FROM EXCLUDED."listedUpdatedAt"
          AND "CxIngestJob".status <> 'PROCESSING'`;
  }

  let cursor: Date;
  let more = false;
  let warning: string | null = null;
  const full = tickets.length >= (ordered ? pageSize : UNORDERED_LIMIT);
  const lastUpdated = tickets.map((t) => parseTime(t.updatedAt)?.getTime() ?? NaN).filter((n) => !Number.isNaN(n));
  if (full && ordered && lastUpdated.length) {
    // Continue from the last ticket on this page (1s back, so tickets sharing that second
    // aren't skipped; re-listing them changes nothing).
    const last = Math.max(...lastUpdated);
    cursor = new Date(last - 1000 > since.getTime() ? last - 1000 : last);
    more = true;
  } else {
    cursor = new Date(now.getTime() - CATCH_UP_OVERLAP_MS);
    if (cursor < since) cursor = since;
    if (full) warning = `More than ${UNORDERED_LIMIT.toLocaleString("en")} tickets changed in one go; some older ones may have been skipped.`;
  }

  await prisma.cxSource.update({
    where: { id: source.id },
    data: { cursor: cursor.toISOString(), lastSyncedAt: now, lastError: warning, ...(source.status === "error" ? { status: "active" } : {}) },
  });
  return { listed: tickets.length, more };
}

/** Polls every active helpdesk source of orgs with CX access (or one org's). */
export async function pollHelpdeskSources(organizationId?: string, now = new Date()): Promise<{ sources: number; listed: number; more: boolean }> {
  const sources = await prisma.cxSource.findMany({ where: { type: "HELPDESK", status: { in: ["active", "error"] }, ...(organizationId ? { organizationId } : {}) } });
  let listed = 0;
  let more = false;
  for (const source of sources) {
    if (!(await getProductAccess(source.organizationId, "CX_INTELLIGENCE")).allowed) continue;
    const result = await pollHelpdeskSource(source as HelpdeskSource, now);
    listed += result.listed;
    more ||= result.more;
  }
  return { sources: sources.length, listed, more };
}

class RateLimited extends Error {}

async function processJob(job: CxIngestJob): Promise<void> {
  const finish = (data: Prisma.CxIngestJobUpdateInput) => prisma.cxIngestJob.update({ where: { id: job.id }, data: { processedAt: new Date(), ...data } });

  const source = await prisma.cxSource.findUnique({ where: { id: job.sourceId } });
  if (!source || source.status === "paused") return void (await finish({ status: "FAILED", lastError: "The source is paused or was removed" }));
  if (!(await getProductAccess(source.organizationId, "CX_INTELLIGENCE")).allowed) {
    return void (await finish({ status: "FAILED", lastError: "CX Intelligence subscription is not active" }));
  }
  const found = await connectionFor(source);
  if ("error" in found) return void (await finish({ status: "FAILED", lastError: found.error }));

  try {
    const ticket = await helpdeskClient(found.connection).getTicket(job.externalId);
    const fields = buildConversation(source.organizationId, ticket, { listedUpdatedAt: job.listedUpdatedAt });
    const mappings = await prisma.agentTeamMapping.findMany({ where: { organizationId: source.organizationId }, select: { matchType: true, value: true, teamId: true } });
    const teamId = matchTeam(mappings, { email: fields.agentEmail });
    const clientId = await resolveClient(source.organizationId, normalizeRequester(ticket.requester));

    const key = { organizationId_provider_externalId: { organizationId: source.organizationId, provider: source.provider, externalId: job.externalId } };
    const existing = await prisma.conversation.findUnique({ where: key, select: { textHash: true } });
    const data = { ...fields, turns: fields.turns as unknown as Prisma.InputJsonValue, teamId, clientId, sourceId: source.id };
    if (existing) {
      // Unchanged text keeps its analysis; changed text (a reopened ticket) is analysed again.
      await prisma.conversation.update({ where: key, data: { ...data, ...(existing.textHash !== fields.textHash ? { analysisStatus: "PENDING" } : {}) } });
    } else {
      await prisma.conversation.create({
        data: { ...data, organizationId: source.organizationId, sourceType: "HELPDESK", provider: source.provider, externalId: job.externalId, channel: null },
      });
    }
    await finish({ status: "DONE", lastError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof HelpdeskAuthError) {
      await prisma.cxSource.update({ where: { id: source.id }, data: { status: "error", lastError: message } });
      return void (await finish({ status: "FAILED", lastError: message }));
    }
    if (/rate limit/i.test(message)) {
      // Not this ticket's fault: put it back without using up an attempt, and stop this run.
      await prisma.cxIngestJob.update({ where: { id: job.id }, data: { status: "QUEUED", startedAt: null, attempts: { decrement: 1 }, lastError: message } });
      throw new RateLimited(message);
    }
    const giveUp = job.attempts >= MAX_ATTEMPTS || error instanceof TicketNotFoundError;
    await prisma.cxIngestJob.update({
      where: { id: job.id },
      data: giveUp ? { status: "FAILED", lastError: message, processedAt: new Date() } : { status: "QUEUED", lastError: message, startedAt: null },
    });
  }
}

/** Works through queued jobs until the time budget is nearly used up. */
export async function processIngestJobs(budgetMs: number, organizationId?: string): Promise<{ processed: number; remaining: number; rateLimited: boolean }> {
  const deadline = Date.now() + budgetMs;
  const scope = organizationId ? { organizationId } : {};

  // Recover jobs from a run that died mid-fetch.
  await prisma.cxIngestJob.updateMany({
    where: { ...scope, status: "PROCESSING", startedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
    data: { status: "QUEUED", startedAt: null },
  });

  let processed = 0;
  let rateLimited = false;
  while (Date.now() < deadline - JOB_HEADROOM_MS && !rateLimited) {
    const batch = await prisma.cxIngestJob.findMany({ where: { ...scope, status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: CONCURRENCY });
    if (batch.length === 0) break;

    const claimed: CxIngestJob[] = [];
    for (const job of batch) {
      const { count } = await prisma.cxIngestJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 } },
      });
      if (count === 1) claimed.push({ ...job, attempts: job.attempts + 1 });
    }
    const results = await Promise.allSettled(claimed.map(processJob));
    rateLimited = results.some((r) => r.status === "rejected" && r.reason instanceof RateLimited);
    processed += claimed.length;
  }

  const remaining = await prisma.cxIngestJob.count({ where: { ...scope, status: "QUEUED" } });
  return { processed, remaining, rateLimited };
}
