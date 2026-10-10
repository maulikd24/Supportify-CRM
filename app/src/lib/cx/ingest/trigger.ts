import { prisma } from "@/lib/db/prisma";

/**
 * Starts a background CX worker invocation: the worker route chains itself with this while
 * work remains, the cron tick kicks it every few minutes, and starting an import kicks it so
 * the first tickets arrive straight away.
 */
export async function triggerCxWorker({ depth = 0, organizationId }: { depth?: number; organizationId?: string } = {}) {
  const base = process.env.APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("The CX worker needs APP_URL and CRON_SECRET");
    return;
  }
  const next = new URL("/api/internal/cron/cx-worker", base);
  next.searchParams.set("depth", String(depth));
  if (organizationId) next.searchParams.set("org", organizationId);
  try {
    await fetch(next, { headers: { "x-cron-secret": secret }, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error("Failed to trigger the CX worker", error);
  }
}

/** From the cron tick: start the worker only when there is something to import, analyse or collect. */
export async function kickCxWorker(): Promise<{ kicked: boolean }> {
  const [sources, queued, pending, inFlight] = await Promise.all([
    prisma.cxSource.count({ where: { status: { in: ["active", "error"] } } }),
    prisma.cxIngestJob.count({ where: { status: "QUEUED" } }),
    prisma.conversation.count({ where: { analysisStatus: "PENDING" } }),
    prisma.cxClassifyBatch.count({ where: { status: "in_progress" } }),
  ]);
  if (sources === 0 && queued === 0 && pending === 0 && inFlight === 0) return { kicked: false };
  await triggerCxWorker();
  return { kicked: true };
}
