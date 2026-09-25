import { prisma } from "@/lib/db/prisma";
import type { Prisma, Stage } from "@/generated/prisma/client";

export type StageDuration = { stageId: string; stageName: string; sequence: number; avgHours: number; sampleSize: number };

/**
 * Average wall-clock time clients spend in each stage, derived from StageHistory transitions.
 * Clients still sitting in a stage count toward it using `now` as a provisional end (reflects live bottlenecks).
 */
export async function getStageDurations(clientWhere: Prisma.ClientWhereInput, stages: Stage[]): Promise<StageDuration[]> {
  const clients = await prisma.client.findMany({
    where: clientWhere,
    select: {
      id: true,
      currentStageId: true,
      stageEnteredAt: true,
      stageHistory: { select: { toStageId: true, changedAt: true }, orderBy: { changedAt: "asc" } },
    },
  });

  const now = new Date();
  const durationsByStage = new Map<string, number[]>();

  for (const client of clients) {
    const transitions = client.stageHistory;
    for (let i = 0; i < transitions.length; i++) {
      const entered = transitions[i];
      const next = transitions[i + 1];
      const end = next ? next.changedAt : now;
      const hours = (end.getTime() - entered.changedAt.getTime()) / (1000 * 60 * 60);
      if (hours < 0) continue;
      const list = durationsByStage.get(entered.toStageId) ?? [];
      list.push(hours);
      durationsByStage.set(entered.toStageId, list);
    }
  }

  return stages.map((stage) => {
    const durations = durationsByStage.get(stage.id) ?? [];
    const avgHours = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return { stageId: stage.id, stageName: stage.name, sequence: stage.sequence, avgHours, sampleSize: durations.length };
  });
}
