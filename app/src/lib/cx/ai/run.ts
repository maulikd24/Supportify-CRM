import { prisma } from "@/lib/db/prisma";
import { getProductAccess } from "@/lib/billing/access";
import { aiConfigured } from "@/lib/cx/ai/client";
import { classifyRealtime, collectClassificationBatches, submitClassificationBatch } from "@/lib/cx/ai/classify";
import { runDiscoveryStep } from "@/lib/cx/ai/discover";
import { cxRealtimeAvailable } from "@/lib/cx/plan-features";

/**
 * The analysis half of the CX worker, per org with CX access: build the topic list if there is
 * none (one step per run), collect finished batches, then send waiting conversations, either as
 * a batch or, on plans with real-time analysis, straight away.
 */
export async function runAnalysis(budgetMs: number, organizationId?: string): Promise<{ orgs: number; pending: number; inFlight: number }> {
  if (!aiConfigured()) return { orgs: 0, pending: 0, inFlight: 0 };
  const deadline = Date.now() + budgetMs;

  await collectClassificationBatches(organizationId);

  const orgIds = organizationId
    ? [organizationId]
    : (await prisma.conversation.groupBy({ by: ["organizationId"], where: { analysisStatus: "PENDING" } })).map((r) => r.organizationId).concat(
        (await prisma.cxSource.findMany({ distinct: ["organizationId"], select: { organizationId: true } })).map((s) => s.organizationId),
      );
  const unique = [...new Set(orgIds)];

  for (const orgId of unique) {
    if (Date.now() > deadline - 20_000) break;
    if (!(await getProductAccess(orgId, "CX_INTELLIGENCE")).allowed) continue;
    const step = await runDiscoveryStep(orgId);
    if (step !== "done") continue; // no topic list yet: conversations wait for it
    if (await cxRealtimeAvailable(orgId)) await classifyRealtime(orgId, deadline - Date.now());
    else await submitClassificationBatch(orgId);
  }

  const scope = organizationId ? { organizationId } : {};
  const [pending, inFlight] = await Promise.all([
    prisma.conversation.count({ where: { ...scope, analysisStatus: "PENDING" } }),
    prisma.cxClassifyBatch.count({ where: { ...scope, status: "in_progress" } }),
  ]);
  return { orgs: unique.length, pending, inFlight };
}
