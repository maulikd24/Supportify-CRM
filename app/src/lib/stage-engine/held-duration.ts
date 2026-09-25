import { prisma } from "@/lib/db/prisma";

/** Total time a client has spent on hold (open or resolved) during its current stage, in milliseconds. */
export async function getHeldDurationMs(clientId: string, stageId: string, now: Date = new Date()): Promise<number> {
  const exceptions = await prisma.exception.findMany({
    where: { clientId, stageId },
    select: { createdAt: true, resolvedAt: true },
  });

  return exceptions.reduce((total, ex) => {
    const end = ex.resolvedAt ?? now;
    return total + Math.max(0, end.getTime() - ex.createdAt.getTime());
  }, 0);
}

/** Shifts stageEnteredAt forward by held time so SLA math effectively excludes hold duration. */
export function effectiveStageEnteredAt(stageEnteredAt: Date, heldDurationMs: number): Date {
  return new Date(stageEnteredAt.getTime() + heldDurationMs);
}
